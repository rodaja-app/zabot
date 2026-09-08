import { PhoneNumberService } from './phone-number.service';

/**
 * Testes unitários puros (sem I/O) do motor de canonicalização/geração de
 * candidatos da Etapa 13 (README raiz §5, passos 1 e 2) — em especial a
 * regra do 9º dígito por DDD, que é a parte mais fácil de quebrar sem
 * perceber ao mexer neste arquivo depois.
 */
describe('PhoneNumberService', () => {
  let service: PhoneNumberService;

  beforeEach(() => {
    service = new PhoneNumberService();
  });

  describe('clean', () => {
    it('remove tudo que não for dígito', () => {
      expect(service.clean('+55 (11) 99999-8888')).toBe('5511999998888');
    });

    it('retorna string vazia quando não há dígito nenhum', () => {
      expect(service.clean('abc')).toBe('');
    });
  });

  describe('generateCandidates', () => {
    it('retorna [] para string vazia', () => {
      expect(service.generateCandidates('')).toEqual([]);
    });

    it('retorna [] quando não sobra estrutura mínima de telefone BR (menos de 10 dígitos)', () => {
      expect(service.generateCandidates('12345')).toEqual([]);
    });

    it('retorna [] quando sobram mais de 11 dígitos após remover DDI/zero de tronco', () => {
      expect(service.generateCandidates('551199999888877')).toEqual([]);
    });

    it('remove o DDI 55 redundante do input', () => {
      const candidates = service.generateCandidates('+5511999998888');
      expect(candidates[0]).toBe('5511999998888');
    });

    it('remove o zero de tronco indevido antes do DDD', () => {
      const candidates = service.generateCandidates('011999998888');
      expect(candidates[0]).toBe('5511999998888');
    });

    it('DDD com 9º dígito obrigatório (ex.: 11): prioriza a variante COM o 9, depois testa sem', () => {
      // DDD 11 exige 9º dígito — assinante de 8 dígitos deve gerar primeiro "9 + assinante"
      const candidates = service.generateCandidates('1188888888');
      expect(candidates).toEqual(['5511988888888', '551188888888']);
    });

    it('DDD sem 9º dígito obrigatório (ex.: 62): prioriza a variante SEM o 9, depois testa com', () => {
      const candidates = service.generateCandidates('6288888888');
      expect(candidates).toEqual(['556288888888', '5562988888888']);
    });

    it('assinante já com 9 dígitos e começando com 9: testa com e sem o 9', () => {
      const candidates = service.generateCandidates('+5511999998888');
      expect(candidates).toEqual(['5511999998888', '551199998888']);
    });

    it('assinante com 8 dígitos e DDD 21 (Rio, exige 9º dígito)', () => {
      const candidates = service.generateCandidates('2177776666');
      expect(candidates).toEqual(['5521977776666', '552177776666']);
    });

    it('nunca troca o DDD por outro — candidatos sempre preservam o DDD original', () => {
      const candidates = service.generateCandidates('1188888888');
      expect(candidates.every((c) => c.startsWith('5511'))).toBe(true);
    });

    it('respeita maxCandidates, retornando no máximo essa quantidade', () => {
      const candidates = service.generateCandidates('1188888888', 1);
      expect(candidates).toEqual(['5511988888888']);
    });

    it('não duplica candidatos quando as variantes coincidem', () => {
      const candidates = service.generateCandidates('1188888888', 5);
      expect(new Set(candidates).size).toBe(candidates.length);
    });
  });

  describe('isStructurallyValid', () => {
    it('aceita um celular BR completo e plausível', () => {
      expect(service.isStructurallyValid('+5511999998888')).toBe(true);
    });

    it('rejeita lixo óbvio', () => {
      expect(service.isStructurallyValid('abc')).toBe(false);
      expect(service.isStructurallyValid('123')).toBe(false);
    });
  });

  describe('toJid / fromJid', () => {
    it('monta o JID no formato esperado pelo Baileys/WhatsApp', () => {
      expect(service.toJid('5511999998888')).toBe('5511999998888@s.whatsapp.net');
    });

    it('extrai os dígitos de volta de um JID simples', () => {
      expect(service.fromJid('5511999998888@s.whatsapp.net')).toBe('5511999998888');
    });

    it('extrai os dígitos de um JID com sufixo de dispositivo (":12")', () => {
      expect(service.fromJid('5511999998888:12@s.whatsapp.net')).toBe('5511999998888');
    });
  });
});
