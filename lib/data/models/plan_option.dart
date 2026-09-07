/// Opção de plano exibida no diálogo "Comparar planos" (Tela Menu, Menu 3).
///
/// [id] identifica o plano para a chamada de [MenuRepository.changePlan];
/// [isCurrent] indica se é o plano atualmente assinado, usado só para
/// destacar a opção na lista de comparação.
class PlanOption {
  const PlanOption({
    required this.id,
    required this.name,
    required this.priceLabel,
    required this.description,
    this.isCurrent = false,
  });

  final String id;
  final String name;
  final String priceLabel;
  final String description;
  final bool isCurrent;
}
