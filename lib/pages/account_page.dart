import 'package:flutter/material.dart';

class AccountPage extends StatelessWidget {
  const AccountPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text('我的账户',
            style: Theme.of(context)
                .textTheme
                .headlineMedium
                ?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 28),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Row(
              children: [
                CircleAvatar(
                    radius: 34,
                    backgroundColor:
                        Theme.of(context).colorScheme.primaryContainer,
                    child: const Icon(Icons.person, size: 38)),
                const SizedBox(width: 16),
                const Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text('FitAI 用户',
                          style: TextStyle(
                              fontSize: 20, fontWeight: FontWeight.bold)),
                      SizedBox(height: 6),
                      Text('user@fitai.app')
                    ])),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Card(
          child: Column(
            children: [
              ListTile(
                  leading: Icon(Icons.person_outline),
                  title: Text('个人资料'),
                  trailing: Icon(Icons.chevron_right)),
              Divider(height: 1, indent: 56),
              ListTile(
                  leading: Icon(Icons.settings_outlined),
                  title: Text('设置'),
                  trailing: Icon(Icons.chevron_right)),
            ],
          ),
        ),
      ],
    );
  }
}
