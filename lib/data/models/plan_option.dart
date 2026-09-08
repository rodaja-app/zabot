/// Opção de plano exibida no diálogo "Comparar planos" (Tela Menu, Menu 3).
///
/// [id] identifica o plano para a chamada de [MenuRepository.changePlan];
/// [isCurrent] indica se é o plano atualmente assinado, usado só para
/// destacar a opção na lista de comparação.
///
/// [messagesLimit] substitui o antigo campo `description` (Etapa 18 —
/// integração final): o backend não gera texto descritivo pronto
/// (`PlanOptionDto`, ver `plans/dto/plan-option.dto.ts`), só o limite
/// numérico de mensagens do plano — a formatação em texto (l10n) fica por
/// conta da tela (`menu_screen.dart`, chave `menu_plan_description`).
class PlanOption {
  const PlanOption({
    required this.id,
    required this.name,
    required this.priceLabel,
    required this.messagesLimit,
    this.isCurrent = false,
  });

  final String id;
  final String name;
  final String priceLabel;
  final int messagesLimit;
  final bool isCurrent;
}
