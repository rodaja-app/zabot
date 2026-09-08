import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('gera hash diferente do texto puro e verifica com sucesso a senha correta', async () => {
    const hash = await service.hash('minhaSenhaForte123');
    expect(hash).not.toBe('minhaSenhaForte123');
    await expect(service.verify(hash, 'minhaSenhaForte123')).resolves.toBe(true);
  });

  it('rejeita senha incorreta', async () => {
    const hash = await service.hash('minhaSenhaForte123');
    await expect(service.verify(hash, 'outraSenha')).resolves.toBe(false);
  });

  it('não lança ao verificar contra um hash corrompido — só retorna false', async () => {
    await expect(service.verify('hash-invalido-qualquer', 'qualquer')).resolves.toBe(false);
  });

  it('duas chamadas de hash para a mesma senha produzem valores diferentes (salt aleatório)', async () => {
    const [hashA, hashB] = await Promise.all([service.hash('senha123456'), service.hash('senha123456')]);
    expect(hashA).not.toBe(hashB);
  });
});
