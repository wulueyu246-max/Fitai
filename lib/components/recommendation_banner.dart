import 'package:flutter/material.dart';

class RecommendationBanner extends StatelessWidget {
  const RecommendationBanner({
    required this.imageAsset,
    required this.onExplore,
    this.title = '今日AI穿搭推荐',
    this.recommendation = '今日适合：轻商务极简\n用清晰肩线和高腰比例提升精气神',
    super.key,
  });

  final String imageAsset;
  final VoidCallback onExplore;
  final String title;
  final String recommendation;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('home-ai-recommendation-banner'),
      height: 210,
      decoration: BoxDecoration(
        color: const Color(0xFF1D1C20),
        borderRadius: BorderRadius.circular(28),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2415111A),
            blurRadius: 26,
            offset: Offset(0, 12),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Positioned(
            right: 0,
            top: 0,
            bottom: 0,
            width: 190,
            child: Image.asset(
              imageAsset,
              fit: BoxFit.cover,
              alignment: Alignment.topCenter,
              cacheWidth: 570,
            ),
          ),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
                colors: [
                  Color(0xFF1B191E),
                  Color(0xFF242128),
                  Color(0xB8242128),
                  Color(0x10242128),
                ],
                stops: [0, 0.52, 0.77, 1],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 16, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 25,
                    letterSpacing: -0.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 7),
                SizedBox(
                  width: 220,
                  child: Text(
                    recommendation,
                    style: TextStyle(
                      color: Color(0xFFD4CED7),
                      fontSize: 13,
                      height: 1.5,
                    ),
                  ),
                ),
                const Spacer(),
                FilledButton.icon(
                  key: const Key('banner-start-analysis'),
                  onPressed: onExplore,
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: const Color(0xFF211E24),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 15,
                      vertical: 11,
                    ),
                  ),
                  icon: const Icon(Icons.auto_awesome_rounded, size: 17),
                  label: const Text(
                    '生成我的方案',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
