import { BufferJSON } from '@whiskeysockets/baileys';
import { clearAuthState, useDbAuthState } from './db-auth-state';

/**
 * Testes unitários com Prisma e `SessionCryptoService` mockados — cobrem o
 * contrato mais sensível deste arquivo: ele substitui inteiramente o
 * `useMultiFileAuthState` do Baileys, então qualquer divergência de forma
 * (`{state, saveCreds}`, serialização Buffer-safe via `BufferJSON`, o
 * caso especial de `app-state-sync-key`) quebraria a lib silenciosamente em
 * produção sem um teste que force o formato exato.
 */
describe('useDbAuthState', () => {
  function buildDeps() {
    const tx = {
      sessionAuthKey: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    const prisma = {
      withTenantContext: jest.fn((_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
    };

    // Cripto "identidade" para o teste: encrypt embrulha o JSON puro num
    // envelope fake, decrypt devolve o mesmo JSON puro — testa a
    // serialização/desserialização real (BufferJSON) sem depender da
    // implementação de fato do AES-256-GCM (já coberta em
    // session-crypto.service.spec.ts, se existir).
    const crypto = {
      encrypt: jest.fn((plaintext: Buffer) => ({
        ciphertext: plaintext,
        iv: Buffer.from('iv-fake'),
        authTag: Buffer.from('tag-fake'),
      })),
      decrypt: jest.fn((payload: { ciphertext: Buffer }) => payload.ciphertext),
    };

    return { prisma, crypto, tx };
  }

  it('usa initAuthCreds() como fallback quando não há credencial salva ainda', async () => {
    const { prisma, crypto, tx } = buildDeps();
    tx.sessionAuthKey.findUnique.mockResolvedValue(null);

    const { state } = await useDbAuthState(prisma as never, crypto as never, 'sessao-1', 'user-1');

    expect(state.creds).toBeDefined();
    expect(state.creds.registered).toBe(false);
  });

  it('decodifica a credencial existente (JSON + BufferJSON.reviver) em vez de gerar uma nova', async () => {
    const { prisma, crypto, tx } = buildDeps();
    const credsSalvas = { registered: true, marcador: 'veio-do-banco' };
    tx.sessionAuthKey.findUnique.mockResolvedValue({
      ciphertext: Buffer.from(JSON.stringify(credsSalvas, BufferJSON.replacer), 'utf8'),
      iv: Buffer.from('iv-fake'),
      authTag: Buffer.from('tag-fake'),
    });

    const { state } = await useDbAuthState(prisma as never, crypto as never, 'sessao-1', 'user-1');

    expect(state.creds).toMatchObject(credsSalvas);
  });

  it('saveCreds() grava a credencial atual sob keyType "creds", keyId ""', async () => {
    const { prisma, crypto, tx } = buildDeps();
    tx.sessionAuthKey.findUnique.mockResolvedValue(null);
    tx.sessionAuthKey.upsert.mockResolvedValue({});

    const { saveCreds } = await useDbAuthState(prisma as never, crypto as never, 'sessao-1', 'user-1');
    await saveCreds();

    expect(tx.sessionAuthKey.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId_keyType_keyId: { sessionId: 'sessao-1', keyType: 'creds', keyId: '' } },
      }),
    );
  });

  describe('keys.get', () => {
    it('busca em lote (um findMany) e decodifica cada linha pelo keyId', async () => {
      const { prisma, crypto, tx } = buildDeps();
      tx.sessionAuthKey.findUnique.mockResolvedValue(null);
      tx.sessionAuthKey.findMany.mockResolvedValue([
        {
          keyId: 'chave-1',
          ciphertext: Buffer.from(JSON.stringify({ valor: 1 }, BufferJSON.replacer), 'utf8'),
          iv: Buffer.from('iv'),
          authTag: Buffer.from('tag'),
        },
      ]);

      const { state } = await useDbAuthState(prisma as never, crypto as never, 'sessao-1', 'user-1');
      const result = await state.keys.get('pre-key', ['chave-1', 'chave-inexistente']);

      expect(tx.sessionAuthKey.findMany).toHaveBeenCalledWith({
        where: { sessionId: 'sessao-1', keyType: 'pre-key', keyId: { in: ['chave-1', 'chave-inexistente'] } },
      });
      expect(result).toEqual({ 'chave-1': { valor: 1 } });
      expect(result).not.toHaveProperty('chave-inexistente');
    });
  });

  describe('keys.set', () => {
    it('upserta chaves com valor e apaga (deleteMany) as marcadas como ausentes', async () => {
      const { prisma, crypto, tx } = buildDeps();
      tx.sessionAuthKey.findUnique.mockResolvedValue(null);

      const { state } = await useDbAuthState(prisma as never, crypto as never, 'sessao-1', 'user-1');
      await state.keys.set({
        'pre-key': {
          'chave-nova': { valor: 42 },
          'chave-removida': undefined,
        },
      } as never);

      expect(tx.sessionAuthKey.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId_keyType_keyId: { sessionId: 'sessao-1', keyType: 'pre-key', keyId: 'chave-nova' } },
        }),
      );
      expect(tx.sessionAuthKey.deleteMany).toHaveBeenCalledWith({
        where: { sessionId: 'sessao-1', keyType: 'pre-key', keyId: 'chave-removida' },
      });
    });
  });
});

describe('clearAuthState', () => {
  it('apaga todas as linhas da sessão', async () => {
    const tx = { sessionAuthKey: { deleteMany: jest.fn() } };
    const prisma = {
      withTenantContext: jest.fn((_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
    };

    await clearAuthState(prisma as never, 'sessao-1', 'user-1');

    expect(tx.sessionAuthKey.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 'sessao-1' } });
  });
});
