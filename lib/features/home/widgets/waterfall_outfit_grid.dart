import 'package:flutter/material.dart';

import '../models/home_content.dart';

class WaterfallOutfitGrid extends StatelessWidget {
  const WaterfallOutfitGrid({
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
        final columnCount = constraints.maxWidth >= 760 ? 3 : 2;
        final columns = List.generate(
          columnCount,
          (_) => <OutfitInspiration>[],
        );

        for (var index = 0; index < items.length; index++) {
          columns[index % columnCount].add(items[index]);
        }

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var index = 0; index < columns.length; index++) ...[
              if (index > 0) const SizedBox(width: 12),
              Expanded(
                child: Column(
                  children: [
                    for (final item in columns[index])
                      Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: _WaterfallCard(
                          item: item,
                          onTap:
                              onItemTap == null ? null : () => onItemTap!(item),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _WaterfallCard extends StatelessWidget {
  const _WaterfallCard({
    required this.item,
    this.onTap,
  });

  final OutfitInspiration item;
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
                child: Image.asset(
                  item.imageAsset,
                  fit: BoxFit.cover,
                  alignment: Alignment.topCenter,
                  cacheWidth: 600,
                  semanticLabel: item.title,
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF292724),
                        fontSize: 14,
                        height: 1.35,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      item.tags.map((tag) => '#$tag').join('  '),
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
