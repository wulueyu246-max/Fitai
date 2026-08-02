import 'package:flutter/material.dart';

class TryOnButton extends StatelessWidget {
  const TryOnButton({
    required this.onPressed,
    this.isLoading = false,
    this.label = 'AI试穿看看',
    this.loadingLabel = '正在准备 AI 模特...',
    this.compact = false,
    this.buttonKey = const Key('ai-try-on-button'),
    super.key,
  });

  final VoidCallback? onPressed;
  final bool isLoading;
  final String label;
  final String loadingLabel;
  final bool compact;
  final Key buttonKey;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        key: buttonKey,
        onPressed: isLoading ? null : onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFF181719),
          foregroundColor: Colors.white,
          disabledBackgroundColor: const Color(0xFFD8D5D1),
          padding: EdgeInsets.symmetric(vertical: compact ? 12 : 17),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(compact ? 14 : 18),
          ),
        ),
        icon: isLoading
            ? const SizedBox(
                width: 17,
                height: 17,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : const Icon(Icons.auto_awesome_rounded, size: 18),
        label: Text(
          isLoading ? loadingLabel : label,
          style: TextStyle(
            fontSize: compact ? 13 : 15,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}
