import 'package:flutter/material.dart';

class FeedReveal extends StatelessWidget {
  const FeedReveal({
    required this.child,
    this.distance = 14,
    super.key,
  });

  final Widget child;
  final double distance;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 360),
      curve: Curves.easeOutCubic,
      child: child,
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(0, distance * (1 - value)),
            child: child,
          ),
        );
      },
    );
  }
}
