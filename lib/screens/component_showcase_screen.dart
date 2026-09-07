import 'package:flutter/material.dart';

import '../widgets/app_button.dart';
import '../widgets/app_password_field.dart';
import '../widgets/app_text_field.dart';
import '../widgets/status_badge.dart';
import '../widgets/zabot_bottom_nav.dart';

/// Tela interna de showcase dos componentes do design system (Etapa 2 do
/// plano, README.md seção 13). Não é uma tela do produto final — serve só
/// para revisar visualmente cada componente antes de usá-los nas telas
/// reais (autenticação, Início, Mensagens, Menu).
class ComponentShowcaseScreen extends StatefulWidget {
  const ComponentShowcaseScreen({super.key});

  @override
  State<ComponentShowcaseScreen> createState() =>
      _ComponentShowcaseScreenState();
}

class _ComponentShowcaseScreenState extends State<ComponentShowcaseScreen> {
  int _navIndex = 0;
  final _nameController = TextEditingController();
  final _passwordController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final titleStyle = Theme.of(context).textTheme.titleMedium;

    return Scaffold(
      appBar: AppBar(title: const Text('Showcase de componentes')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Botões', style: titleStyle),
          const SizedBox(height: 12),
          AppButton(label: 'Ação principal', onPressed: () {}),
          const SizedBox(height: 24),

          Text('Campos', style: titleStyle),
          const SizedBox(height: 12),
          AppTextField(label: 'Nome', controller: _nameController),
          const SizedBox(height: 12),
          AppPasswordField(label: 'Senha', controller: _passwordController),
          const SizedBox(height: 24),

          Text('Status', style: titleStyle),
          const SizedBox(height: 12),
          const Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              StatusBadge(status: AppStatus.connected, label: 'Conectado'),
              StatusBadge(status: AppStatus.pending, label: 'Pendente'),
              StatusBadge(status: AppStatus.failed, label: 'Falha'),
              StatusBadge(status: AppStatus.sent, label: 'Enviado'),
            ],
          ),
        ],
      ),
      bottomNavigationBar: ZaBotBottomNav(
        currentIndex: _navIndex,
        onTap: (index) => setState(() => _navIndex = index),
      ),
    );
  }
}
