import 'package:flutter/material.dart';

/// Transição de navegação padrão do ZaBot (Etapa 8, README.md seção 13:
/// "integração fina das animações (...) nas transições entre telas").
///
/// Fade + leve deslizamento vertical (de baixo para cima), substituindo o
/// slide horizontal padrão do Material em todas as navegações internas do
/// app, para reforçar a identidade visual definida no design system.
class AppPageRoute<T> extends PageRouteBuilder<T> {
  AppPageRoute({required WidgetBuilder builder})
      : super(
          pageBuilder: (context, animation, secondaryAnimation) =>
              builder(context),
          transitionDuration: const Duration(milliseconds: 280),
          reverseTransitionDuration: const Duration(milliseconds: 220),
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            final curved = CurvedAnimation(
              parent: animation,
              curve: Curves.easeOutCubic,
              reverseCurve: Curves.easeInCubic,
            );
            return FadeTransition(
              opacity: curved,
              child: SlideTransition(
                position: Tween<Offset>(
                  begin: const Offset(0, 0.04),
                  end: Offset.zero,
                ).animate(curved),
                child: child,
              ),
            );
          },
        );
}
