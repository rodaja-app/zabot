import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  SignalDataTypeMap,
  initAuthCreds,
  proto,
} from '@whiskeysockets/baileys';
import { PrismaService } from '../prisma/prisma.service';
import { SessionCryptoService } from '../common/security/session-crypto.service';

/**
 * Substitui o `useMultiFileAuthState` padrão do Baileys (que grava um
 * arquivo por chave em disco) por persistência em `session_auth_keys`,
 * criptografada via `SessionCryptoService` — ver comentário do model
 * `SessionAuthKey` em schema.prisma para o porquê. Mesma forma/contrato do
 * helper oficial do Baileys (`{ state, saveCreds }`), só troca o backend de
 * arquivo por Postgres, então o resto da integração (baileys-whatsapp.provider.ts)
 * usa exatamente como usaria o helper original.
 *
 * Toda leitura/escrita passa por `PrismaService.withTenantContext(userId, ...)`
 * — a mesma regra de RLS que vale para o resto do sistema vale aqui, mesmo
 * sendo um worker de sessão em vez de uma requisição HTTP.
 */
export async function useDbAuthState(
  prisma: PrismaService,
  crypto: SessionCryptoService,
  sessionId: string,
  userId: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const readOne = async (keyType: string, keyId: string): Promise<unknown> => {
    return prisma.withTenantContext(userId, async (tx) => {
      const row = await tx.sessionAuthKey.findUnique({
        where: { sessionId_keyType_keyId: { sessionId, keyType, keyId } },
      });
      if (!row) return null;
      const json = crypto
        .decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag })
        .toString('utf8');
      return JSON.parse(json, BufferJSON.reviver);
    });
  };

  const writeOne = async (keyType: string, keyId: string, value: unknown): Promise<void> => {
    const json = JSON.stringify(value, BufferJSON.replacer);
    const { ciphertext, iv, authTag } = crypto.encrypt(Buffer.from(json, 'utf8'));
    await prisma.withTenantContext(userId, (tx) =>
      tx.sessionAuthKey.upsert({
        where: { sessionId_keyType_keyId: { sessionId, keyType, keyId } },
        create: { sessionId, userId, keyType, keyId, ciphertext, iv, authTag },
        update: { ciphertext, iv, authTag },
      }),
    );
  };

  const creds: AuthenticationCreds = ((await readOne('creds', '')) as AuthenticationCreds) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const rows = await prisma.withTenantContext(userId, (tx) =>
            tx.sessionAuthKey.findMany({
              where: { sessionId, keyType: type, keyId: { in: ids } },
            }),
          );
          const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          for (const row of rows) {
            const decrypted = crypto.decrypt({
              ciphertext: row.ciphertext,
              iv: row.iv,
              authTag: row.authTag,
            });
            let value: unknown = JSON.parse(decrypted.toString('utf8'), BufferJSON.reviver);
            // Caso especial preservado do useMultiFileAuthState original: o
            // Baileys espera essa categoria já reidratada como mensagem
            // proto, não como objeto JSON puro.
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
            }
            result[row.keyId] = value as SignalDataTypeMap[typeof type];
          }
          return result;
        },
        set: async (data) => {
          // Sequencial de propósito: uma transação interativa do Prisma não
          // aceita queries concorrentes na mesma conexão — Promise.all aqui
          // quebraria a transação.
          await prisma.withTenantContext(userId, async (tx) => {
            for (const keyType of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
              const category = data[keyType];
              if (!category) continue;
              for (const keyId of Object.keys(category)) {
                const value = category[keyId];
                if (value) {
                  const json = JSON.stringify(value, BufferJSON.replacer);
                  const { ciphertext, iv, authTag } = crypto.encrypt(Buffer.from(json, 'utf8'));
                  await tx.sessionAuthKey.upsert({
                    where: { sessionId_keyType_keyId: { sessionId, keyType, keyId } },
                    create: { sessionId, userId, keyType, keyId, ciphertext, iv, authTag },
                    update: { ciphertext, iv, authTag },
                  });
                } else {
                  await tx.sessionAuthKey.deleteMany({ where: { sessionId, keyType, keyId } });
                }
              }
            }
          });
        },
      },
    },
    saveCreds: () => writeOne('creds', '', creds),
  };
}

/**
 * Apaga todo o auth state de uma sessão (todas as linhas em
 * `session_auth_keys`). Chamado quando o Baileys reporta um logout
 * definitivo (ver `isDefinitive()` em baileys-whatsapp.provider.ts) — as
 * credenciais antigas viram lixo nesse ponto; reconectar exige QR/pareamento
 * novo, então mantê-las só ocuparia espaço e criaria confusão sobre "qual é
 * o estado de verdade" da sessão.
 */
export async function clearAuthState(
  prisma: PrismaService,
  sessionId: string,
  userId: string,
): Promise<void> {
  await prisma.withTenantContext(userId, (tx) =>
    tx.sessionAuthKey.deleteMany({ where: { sessionId } }),
  );
}
