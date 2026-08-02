import 'package:flutter/material.dart';

import '../models/home_content.dart';
import 'outfit_feed_card.dart';

class OutfitFeedGrid extends StatelessWidget {
  const OutfitFeedGrid({
    required this.items,
    this.onItemTap,
    super.key,
  });

  final List<OutfitInspiration> items;
  final ValueChanged<OutfitInspiration>? onItemTap;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columnCount = constraints.maxWidth >= 720 ? 3 : 2;
        const spacing = 12.0;
        final cardWidth =
            (constraints.maxWidth - spacing * (columnCount - 1)) / columnCount;

        return Wrap(
          spacing: spacing,
          runSpacing: 14,
          children: [
            for (final item in items)
              SizedBox(
                width: cardWidth,
                child: OutfitFeedCard(
                  inspiration: item,
                  onTap: onItemTap == null ? null : () => onItemTap!(item),
                ),
              ),
          ],
        );
      },
    );
  }
}
