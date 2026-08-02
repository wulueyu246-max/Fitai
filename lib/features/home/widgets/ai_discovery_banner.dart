import 'package:flutter/material.dart';

class AiDiscoveryBanner extends StatelessWidget {
  const AiDiscoveryBanner({
    required this.onExplore,
    required this.imageAsset,
    super.key,
  });

  final VoidCallback onExplore;
  final String imageAsset;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 194,
      child: Container(
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color(0xFF1E1C22),
              Color(0xFF34303C),
            ],
          ),
          borderRadius: BorderRadius.circular(28),
          boxShadow: const [
            BoxShadow(
              color: Color(0x241A1520),
              blurRadius: 28,
              offset: Offset(0, 14),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          children: [
            Positioned.fill(
              child: Row(
                children: [
                  const Spacer(flex: 52),
                  Expanded(
                    flex: 48,
                    child: Image.asset(
                      imageAsset,
                      height: double.infinity,
                      fit: BoxFit.cover,
                      alignment: Alignment.topCenter,
                      cacheWidth: 600,
                      semanticLabel: 'AI 穿搭体验',
                    ),
                  ),
                ],
              ),
            ),
            const Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                    stops: [0, 0.54, 0.78, 1],
                    colors: [
                      Color(0xFF1B191F),
                      Color(0xFF242129),
                      Color(0xB3242129),
                      Color(0x10242129),
                    ],
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 16, 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.12),
                      ),
                    ),
                    child: const Text(
                      '专属穿搭 · 约 30 秒',
                      style: TextStyle(
                        color: Color(0xFFD8D1E4),
                        fontSize: 10.5,
                        letterSpacing: 0.2,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'AI认识你的风格',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      height: 1.1,
                      letterSpacing: -0.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 5),
                  const SizedBox(
                    width: 205,
                    child: Text(
                      '上传照片，立即获得真正适合你的穿搭方案',
                      style: TextStyle(
                        color: Color(0xFFD0CCD4),
                        fontSize: 12.5,
                        height: 1.4,
                      ),
                    ),
                  ),
                  const Spacer(),
                  FilledButton.icon(
                    onPressed: onExplore,
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: const Color(0xFF211F25),
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 15,
                        vertical: 10,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(13),
                      ),
                      visualDensity: VisualDensity.compact,
                    ),
                    icon: const Icon(Icons.auto_awesome_rounded, size: 16),
                    label: const Text(
                      '立即体验',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
