import 'package:flutter/material.dart';

import '../../../components/product_image.dart';
import '../../../models/product.dart';
import '../models/fashion_feed.dart';

class TodayAiRecommendationCard extends StatelessWidget {
  const TodayAiRecommendationCard({
    required this.feed,
    required this.onGenerate,
    required this.onSave,
    required this.saved,
    super.key,
  });

  final FashionFeed feed;
  final VoidCallback onGenerate;
  final VoidCallback onSave;
  final bool saved;

  @override
  Widget build(BuildContext context) {
    final plan = feed.dailyPlan;
    return Container(
      key: const Key('today-ai-recommendation'),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF17382A), Color(0xFF42644E)],
        ),
        borderRadius: BorderRadius.circular(28),
        boxShadow: const [
          BoxShadow(
            color: Color(0x3517131C),
            blurRadius: 28,
            offset: Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 11,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0x2AFFFFFF),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: const Color(0x33FFFFFF)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.cloud_outlined,
                        size: 16,
                        color: Colors.white,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '${feed.context.city} · ${feed.context.temperatureLabel} '
                          '${feed.context.detailLabel}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 11,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFDDE8D9),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  feed.scene,
                  style: const TextStyle(
                    color: Color(0xFF244C3A),
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              IconButton(
                key: const Key('favorite-daily-look'),
                tooltip: saved ? '取消保存' : '保存今日Look',
                onPressed: onSave,
                style: IconButton.styleFrom(
                  backgroundColor: const Color(0x20FFFFFF),
                  foregroundColor:
                      saved ? const Color(0xFFFFA0B1) : Colors.white,
                ),
                icon: Icon(
                  saved
                      ? Icons.favorite_rounded
                      : Icons.favorite_border_rounded,
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          const Text(
            '今日AI穿搭推荐',
            style: TextStyle(
              color: Color(0xFFDDE8D9),
              fontSize: 12,
              letterSpacing: 0.8,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            plan.title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 26,
              height: 1.18,
              letterSpacing: -0.5,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            feed.dailyReason,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFFE2E7DF),
              fontSize: 12.5,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 17),
          Row(
            children: [
              for (final product in plan.products) ...[
                Expanded(
                  child: _DailyProductTile(product: product),
                ),
                if (product != plan.products.last) const SizedBox(width: 8),
              ],
            ],
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              key: const Key('banner-start-analysis'),
              onPressed: onGenerate,
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: const Color(0xFF211E24),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              icon: const Icon(Icons.auto_awesome_rounded, size: 18),
              label: const Text(
                '生成我的方案',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DailyProductTile extends StatelessWidget {
  const _DailyProductTile({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0x16FFFFFF),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x22FFFFFF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 1,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(11),
              child: ColoredBox(
                color: const Color(0xFFF7F4F7),
                child: ProductImage(
                  product: product,
                  fit: BoxFit.cover,
                ),
              ),
            ),
          ),
          const SizedBox(height: 7),
          Text(
            product.wardrobeSlot,
            style: const TextStyle(
              color: Color(0xFFBDAFC3),
              fontSize: 9,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            product.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}
