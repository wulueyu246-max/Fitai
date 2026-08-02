import 'dart:typed_data';

import 'package:flutter/material.dart';

class PersonalOutfitHeader extends StatelessWidget {
  const PersonalOutfitHeader({
    required this.imageBytes,
    required this.scene,
    super.key,
  });

  final Uint8List? imageBytes;
  final String scene;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF1F1D22),
        borderRadius: BorderRadius.circular(26),
        boxShadow: const [
          BoxShadow(
            color: Color(0x241C171E),
            blurRadius: 24,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          Hero(
            tag: 'fitai-user-photo',
            child: Container(
              width: 88,
              height: 112,
              decoration: BoxDecoration(
                color: const Color(0xFF3A353D),
                borderRadius: BorderRadius.circular(20),
              ),
              clipBehavior: Clip.antiAlias,
              child: _buildPhoto(),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'SHUPI PERSONAL LOOK',
                  style: TextStyle(
                    color: Color(0xFFBFAEC9),
                    fontSize: 10,
                    letterSpacing: 1.2,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  '你的专属穿搭方案',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 23,
                    height: 1.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 9),
                Text(
                  '$scene场景 · 基于身体比例与风格偏好生成',
                  style: const TextStyle(
                    color: Color(0xFFD1CAD3),
                    fontSize: 12,
                    height: 1.45,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPhoto() {
    final bytes = imageBytes;
    if (bytes == null) {
      return const Icon(
        Icons.person_rounded,
        size: 46,
        color: Color(0xFFB9AFC0),
      );
    }
    return Image.memory(
      bytes,
      fit: BoxFit.cover,
      cacheWidth: 240,
      errorBuilder: (_, __, ___) => const Icon(
        Icons.person_rounded,
        size: 46,
        color: Color(0xFFB9AFC0),
      ),
    );
  }
}
