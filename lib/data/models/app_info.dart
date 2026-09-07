import '../../widgets/status_badge.dart';

/// Informações do card "Sobre" na Tela Menu (Menu 3).
///
/// Reaproveita [AppStatus] para o indicador de status do serviço:
/// `connected` = operacional, `pending` = degradado, `failed` = fora do ar.
class AppInfo {
  const AppInfo({required this.version, required this.serviceStatus});

  final String version;
  final AppStatus serviceStatus;
}
