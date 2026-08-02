import 'package:flutter/material.dart';
import '../config/shupi_theme.dart';

class FitAILaunchPlaceholder extends StatelessWidget {
  const FitAILaunchPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: ShupiColors.ivory,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ShupiMark(size: 54, showName: false),
            SizedBox(height: 14),
            Text(
              '树皮 Shupi',
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900),
            ),
          ],
        ),
      ),
    );
  }
}
