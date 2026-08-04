import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';

import '../models/outfit_generation_state.dart';

class AiGenerationLoadingPanel extends StatelessWidget {
  const AiGenerationLoadingPanel({
    required this.state,
    this.detailMessage,
    this.animationAsset = 'assets/animations/ai_styling.json',
    super.key,
  });

  final OutfitGenerationState state;
  final String? detailMessage;
  final String animationAsset;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('ai-generation-loading-panel'),
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFDDE5DC)),
      ),
      child: Column(
        children: [
          const Text(
            'AI 正在为你生成穿搭',
            style: TextStyle(
              color: Color(0xFF1F352B),
              fontSize: 19,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: 132,
            height: 132,
            child: Lottie.asset(
              animationAsset,
              key: const Key('ai-generation-lottie'),
              repeat: true,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => const Center(
                child: CircularProgressIndicator(
                  key: Key('ai-generation-fallback-spinner'),
                  strokeWidth: 3,
                  color: Color(0xFF244C3A),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  key: Key('ai-generation-spinner'),
                  strokeWidth: 2.5,
                  color: Color(0xFF244C3A),
                ),
              ),
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  detailMessage ?? state.label,
                  key: const Key('ai-generation-stage'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Color(0xFF244C3A),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const LinearProgressIndicator(
            key: Key('ai-generation-linear-progress'),
            minHeight: 4,
            color: Color(0xFF527A62),
            backgroundColor: Color(0xFFE3EBE1),
          ),
          const SizedBox(height: 14),
          const Text(
            '请不要退出页面。通常需要几十秒，首次请求可能因云服务唤醒而稍慢。',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF77716C),
              fontSize: 12.5,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}
