import 'package:flutter/material.dart';

/// Paleta oficial do ZaBot (ver README.md, seção 14).
/// Roxo e verde (o verde do WhatsApp) são as duas cores de marca, sempre em
/// tons foscos — sem cores neon/brilhantes. O verde deixou de ser só um
/// indicador de status pontual: agora também aparece em navegação, no
/// gradiente dos elementos de destaque (mascote, botão principal) e em
/// acentos, lado a lado com o roxo.
class AppColors {
  AppColors._();

  static const Color purplePrimary = Color(0xFF6C56C9);
  static const Color purpleDark = Color(0xFF241B3D);

  /// Verde de marca (tom fosco inspirado no verde do WhatsApp). Usado em
  /// navegação, gradientes de destaque e nos indicadores de sucesso/conexão.
  static const Color greenPrimary = Color(0xFF2EA96B);
  static const Color greenDark = Color(0xFF14512E);

  static const Color background = Color(0xFF121016);

  /// Cor dos "quadrados" (cards) da interface — Início, Mensagens e Menu.
  /// Precisa ficar visivelmente mais clara que [background] e mais escura
  /// que [borderDivider], senão os blocos somem no fundo preto.
  static const Color surfaceCard = Color(0xFF241F30);

  static const Color borderDivider = Color(0xFF453C5C);
  static const Color textSecondary = Color(0xFFA8A3B3);
  static const Color textPrimary = Color(0xFFF5F3F7);

  /// Indicador de sucesso/conectado — usa o mesmo verde de marca.
  static const Color statusGreen = greenPrimary;

  static const Color statusError = Color(0xFFE85C5C);

  /// Degradê fosco roxo → verde usado nos elementos de destaque do app
  /// (fundo do mascote, botão de ação principal). Sempre fosco, sem brilho.
  static const LinearGradient heroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [purplePrimary, greenPrimary],
  );

  /// Tom escuro do vermelho, usado como topo do [dangerGradient].
  static const Color redDark = Color(0xFF3D1B22);

  /// Degradê fosco puxando para o vermelho (de cima pra baixo), usado em
  /// ações destrutivas/irreversíveis (ex.: limpar histórico de envio).
  static const LinearGradient dangerGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [redDark, statusError],
  );
}

class AppTheme {
  AppTheme._();

  static ThemeData dark() {
    final colorScheme = const ColorScheme.dark(
      brightness: Brightness.dark,
      primary: AppColors.purplePrimary,
      onPrimary: AppColors.textPrimary,
      secondary: AppColors.greenPrimary,
      onSecondary: AppColors.textPrimary,
      surface: AppColors.surfaceCard,
      onSurface: AppColors.textPrimary,
      error: AppColors.statusError,
      onError: AppColors.textPrimary,
      outline: AppColors.borderDivider,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.background,
      textTheme: const TextTheme(
        titleLarge: TextStyle(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w700,
        ),
        titleMedium: TextStyle(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w600,
        ),
        bodyLarge: TextStyle(color: AppColors.textPrimary),
        bodyMedium: TextStyle(color: AppColors.textSecondary),
      ),
      cardTheme: CardThemeData(
        color: AppColors.surfaceCard,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.borderDivider, width: 1),
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        centerTitle: false,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppColors.surfaceCard,
        selectedItemColor: AppColors.greenPrimary,
        unselectedItemColor: AppColors.textSecondary,
        type: BottomNavigationBarType.fixed,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.purplePrimary,
          foregroundColor: AppColors.textPrimary,
          elevation: 0,
          shadowColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.borderDivider,
        thickness: 1,
      ),
    );
  }
}
