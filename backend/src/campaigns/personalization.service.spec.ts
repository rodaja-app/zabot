import { PersonalizationService } from './personalization.service';

/**
 * Cobre a única regra que importa aqui: token conhecido vira o valor, token
 * desconhecido/valor vazio permanece literal (nunca é apagado — apagar
 * esconderia erro de digitação/import na hora de revisar a campanha), e
 * marcadores de formatação do WhatsApp (`*negrito*`, `_itálico_`) não são
 * tocados por não baterem no padrão `{IDn}`.
 */
describe('PersonalizationService', () => {
  const service = new PersonalizationService();

  it('substitui tokens conhecidos pelos valores do contato', () => {
    const result = service.render('Olá {ID1}, sua fatura de {ID2} venceu.', { ID1: 'João', ID2: 'Setembro' });
    expect(result).toBe('Olá João, sua fatura de Setembro venceu.');
  });

  it('mantém o token literal quando a chave não existe em customFields', () => {
    const result = service.render('Olá {ID1}, código {ID9}.', { ID1: 'Maria' });
    expect(result).toBe('Olá Maria, código {ID9}.');
  });

  it('mantém o token literal quando o valor é string vazia (nunca apaga)', () => {
    const result = service.render('Empresa: {ID3}', { ID3: '' });
    expect(result).toBe('Empresa: {ID3}');
  });

  it('não altera texto sem tokens nem marcadores de formatação do WhatsApp', () => {
    const template = '*Promoção* imperdível, _corra_ e garanta já!';
    expect(service.render(template, {})).toBe(template);
  });

  it('substitui múltiplas ocorrências do mesmo token', () => {
    const result = service.render('{ID1}, {ID1}, {ID1}!', { ID1: 'Oi' });
    expect(result).toBe('Oi, Oi, Oi!');
  });
});
