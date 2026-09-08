import { VerificationCodeService } from './verification-code.service';

describe('VerificationCodeService', () => {
  const service = new VerificationCodeService();

  it('gera código de 6 dígitos numéricos', () => {
    const { code } = service.generate();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('o hash do código gerado bate com o hash recalculado do mesmo código', () => {
    const { code, hash } = service.generate();
    expect(service.hash(code)).toBe(hash);
  });

  it('hashes de códigos diferentes não colidem', () => {
    const a = service.generate();
    let b = service.generate();
    // Regenera em caso raro de colisão de código pra não deixar o teste flaky.
    while (b.code === a.code) {
      b = service.generate();
    }
    expect(service.hash(a.code)).not.toBe(service.hash(b.code));
  });

  it('ignora espaços ao redor do código ao gerar o hash (mesma robustez do trim usado no confronto)', () => {
    expect(service.hash(' 123456 ')).toBe(service.hash('123456'));
  });
});
