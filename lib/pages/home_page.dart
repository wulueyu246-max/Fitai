import 'package:flutter/material.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.checkroom,
                  size: 64, color: Theme.of(context).colorScheme.primary),
            ),
            const SizedBox(height: 28),
            Text('FitAI',
                style: Theme.of(context)
                    .textTheme
                    .displaySmall
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Text('AI帮你打造专属穿搭',
                style: Theme.of(context).textTheme.titleLarge,
                textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
