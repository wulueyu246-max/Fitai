import 'package:flutter/material.dart';

import '../features/home/models/home_content.dart';

class OutfitCard extends StatelessWidget {
  const OutfitCard({
    required this.outfit,
    required this.favorite,
    required this.onFavorite,
    required this.onTap,
    super.key,
  });

  final OutfitInspiration outfit;
  final bool favorite;
  final VoidCallback onFavorite;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D1D1813),
            blurRadius: 18,
            offset: Offset(0, 7),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AspectRatio(
                aspectRatio: 4 / 5,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Image.asset(
                      outfit.imageAsset,
                      fit: BoxFit.cover,
                      alignment: Alignment.topCenter,
                      cacheWidth: 650,
                    ),
                    Positioned(
                      right: 9,
                      top: 9,
                      child: IconButton.filledTonal(
                        key: Key('favorite-${outfit.id}'),
                        tooltip: favorite ? '取消收藏' : '收藏穿搭',
                        onPressed: onFavorite,
                        style: IconButton.styleFrom(
                          backgroundColor: Colors.white.withValues(alpha: 0.9),
                          foregroundColor: favorite
                              ? const Color(0xFF9F4055)
                              : const Color(0xFF4C4642),
                        ),
                        icon: Icon(
                          favorite
                              ? Icons.favorite_rounded
                              : Icons.favorite_border_rounded,
                          size: 19,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(13, 12, 13, 15),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      outfit.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF211F1D),
                        fontSize: 15,
                        height: 1.35,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'AI推荐 · ${outfit.aiReason}',
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF6F6179),
                        fontSize: 11.5,
                        height: 1.45,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      outfit.audience,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF8B8580),
                        fontSize: 10.5,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
