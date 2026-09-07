/// Configurações do app, exibidas na Tela Menu (Etapa 6, README.md
/// seção 13).
class AppSettings {
  const AppSettings({
    required this.notificationsEnabled,
    required this.soundEnabled,
  });

  final bool notificationsEnabled;
  final bool soundEnabled;

  AppSettings copyWith({bool? notificationsEnabled, bool? soundEnabled}) {
    return AppSettings(
      notificationsEnabled:
          notificationsEnabled ?? this.notificationsEnabled,
      soundEnabled: soundEnabled ?? this.soundEnabled,
    );
  }
}
