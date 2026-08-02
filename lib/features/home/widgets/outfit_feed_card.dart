import 'package:flutter/material.dart';

import '../models/home_content.dart';

class OutfitFeedCard extends StatelessWidget {
  const OutfitFeedCard({
    required this.inspiration,
    this.onTap,
    super.key,
  });

  final OutfitInspiration inspiration;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0C231E18),
            blurRadius: 16,
            offset: Offset(0, 6),
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
                      inspiration.imageAsset,
                      fit: BoxFit.cover,
                      alignment: Alignment.topCenter,
                      cacheWidth: 600,
                      semanticLabel: inspiration.title,
                    ),
                    const DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          stops: [0.62, 1],
                          colors: [
                            Colors.transparent,
                            Color(0x8A151310),
                          ],
                        ),
                      ),
                    ),
                    Positioned(
                      left: 10,
                      bottom: 10,
                      child: _ImageLabel(
                        label: '#${inspiration.tags.first}',
                      ),
                    ),
                    Positioned(
                      right: 10,
                      bottom: 10,
                      child: Row(
                        children: [
                          const Icon(
                            Icons.visibility_rounded,
                            size: 13,
                            color: Colors.white,
                          ),
                          const SizedBox(width: 3),
                          Text(
                            inspiration.views,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 11, 12, 13),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      height: 40,
                      child: Text(
                        inspiration.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF1B1A18),
                          fontSize: 14.5,
                          height: 1.35,
                          letterSpacing: -0.1,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      inspiration.tags.skip(1).isEmpty
                          ? '精选穿搭灵感'
                          : inspiration.tags
                              .skip(1)
                              .map((tag) => '#$tag')
                              .join('  '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF806F92),
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
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

class _ImageLabel extends StatelessWidget {
  const _ImageLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.38),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.24)),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
