import 'package:flutter/material.dart';

import '../models/product.dart';
import 'product_image.dart';
import 'try_on_button.dart';

class ProductCard extends StatelessWidget {
  const ProductCard({
    required this.product,
    required this.selected,
    this.compact = false,
    this.onTap,
    this.onViewDetails,
    this.onTryOn,
    this.onFavorite,
    this.onAddToWardrobe,
    this.onBuy,
    this.favorite = false,
    this.isTryOnLoading = false,
    super.key,
  });

  final Product product;
  final bool selected;
  final bool compact;
  final VoidCallback? onTap;
  final VoidCallback? onViewDetails;
  final VoidCallback? onTryOn;
  final VoidCallback? onFavorite;
  final VoidCallback? onAddToWardrobe;
  final VoidCallback? onBuy;
  final bool favorite;
  final bool isTryOnLoading;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: '${product.brand} ${product.name}，${selected ? "已选择" : "未选择"}',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          key: Key('product-${product.id}'),
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            decoration: BoxDecoration(
              color: const Color(0xFFFAF9F7),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: selected
                    ? const Color(0xFF1E1C22)
                    : const Color(0xFFE9E6E1),
                width: selected ? 1.5 : 1,
              ),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AspectRatio(
                  aspectRatio: compact ? 1.25 : 4 / 3,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      ProductImage(
                        product: product,
                        fit: BoxFit.contain,
                        cacheWidth: compact ? 360 : 540,
                      ),
                      Positioned(
                        left: 10,
                        top: 10,
                        child: Material(
                          color: Colors.white.withValues(alpha: 0.92),
                          shape: const CircleBorder(),
                          child: IconButton(
                            key: Key('favorite-${product.id}'),
                            tooltip: favorite ? '取消收藏' : '收藏商品',
                            onPressed: onFavorite,
                            visualDensity: VisualDensity.compact,
                            iconSize: 18,
                            icon: Icon(
                              favorite
                                  ? Icons.favorite_rounded
                                  : Icons.favorite_border_rounded,
                              color: favorite
                                  ? const Color(0xFFC94257)
                                  : const Color(0xFF4B4742),
                            ),
                          ),
                        ),
                      ),
                      Positioned(
                        right: 10,
                        top: 10,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 180),
                          width: 27,
                          height: 27,
                          decoration: BoxDecoration(
                            color: selected
                                ? const Color(0xFF1D1B1F)
                                : Colors.white.withValues(alpha: 0.9),
                            shape: BoxShape.circle,
                            boxShadow: const [
                              BoxShadow(
                                color: Color(0x181C1712),
                                blurRadius: 8,
                              ),
                            ],
                          ),
                          child: Icon(
                            selected ? Icons.check_rounded : Icons.add_rounded,
                            size: 17,
                            color: selected
                                ? Colors.white
                                : const Color(0xFF4B4742),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: EdgeInsets.all(compact ? 12 : 15),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        product.brand,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF53715C),
                          fontSize: 10.5,
                          letterSpacing: 0.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        product.name,
                        style: TextStyle(
                          color: const Color(0xFF201E1C),
                          fontSize: compact ? 13 : 15,
                          height: 1.3,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 7),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          _ProductTag(product.style),
                          _ProductTag(product.fitType),
                          _ProductTag(product.season),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${product.category} · ${product.color}',
                              style: const TextStyle(
                                color: Color(0xFF807B75),
                                fontSize: 11,
                              ),
                            ),
                          ),
                          Text(
                            product.displayPrice,
                            style: const TextStyle(
                              color: Color(0xFF201E1C),
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                      if (!compact) ...[
                        const SizedBox(height: 12),
                        Text(
                          '${product.material} · 尺码 ${product.size} · '
                          '${product.inStock ? "库存 ${product.stock}" : "暂时缺货"}',
                          style: const TextStyle(
                            color: Color(0xFF837C76),
                            fontSize: 10.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          product.description,
                          style: const TextStyle(
                            color: Color(0xFF69645F),
                            fontSize: 12,
                            height: 1.45,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFFE8EFE6),
                            borderRadius: BorderRadius.circular(13),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  const Expanded(
                                    child: Text(
                                      '为什么推荐',
                                      style: TextStyle(
                                        color: Color(0xFF355B43),
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ),
                                  Text(
                                    '搭配位置：${_placement(product)}',
                                    style: const TextStyle(
                                      color: Color(0xFF657166),
                                      fontSize: 9.5,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 7),
                              _FitReason(
                                label: '身材适配',
                                value: product.aiReason,
                              ),
                              _FitReason(
                                label: '风格匹配',
                                value: '符合你的${product.style}穿搭偏好',
                              ),
                              _FitReason(
                                label: '场景匹配',
                                value: '适合${product.season}与当前场景搭配',
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                key: Key('details-${product.id}'),
                                onPressed: onViewDetails,
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: const Color(0xFF3E393F),
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 12,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                ),
                                child: const Text(
                                  '查看详情',
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                            ),
                            if (onTryOn != null) ...[
                              const SizedBox(width: 8),
                              Expanded(
                                child: TryOnButton(
                                  onPressed:
                                      product.tryOnAvailable ? onTryOn : null,
                                  isLoading: isTryOnLoading,
                                  label: '立即试穿',
                                  loadingLabel: '准备中...',
                                  compact: true,
                                  buttonKey: Key('try-on-${product.id}'),
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                key: Key('wardrobe-${product.id}'),
                                onPressed: onAddToWardrobe ?? onFavorite,
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: const Color(0xFF3E393F),
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 10),
                                  visualDensity: VisualDensity.compact,
                                ),
                                icon: const Icon(
                                  Icons.checkroom_outlined,
                                  size: 15,
                                ),
                                label: const Text(
                                  '加入衣橱',
                                  style: TextStyle(
                                    fontSize: 10.5,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: FilledButton.icon(
                                key: Key('buy-${product.id}'),
                                onPressed: product.inStock
                                    ? (onBuy ?? onViewDetails)
                                    : null,
                                style: FilledButton.styleFrom(
                                  backgroundColor: const Color(0xFF244C3A),
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 10),
                                  visualDensity: VisualDensity.compact,
                                ),
                                icon: const Icon(
                                  Icons.shopping_bag_outlined,
                                  size: 15,
                                ),
                                label: const Text(
                                  '立即购买',
                                  style: TextStyle(
                                    fontSize: 10.5,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _placement(Product product) {
    return switch (product.wardrobeSlot) {
      ProductCategory.top => '上装',
      ProductCategory.bottom => '下装',
      ProductCategory.shoes => '鞋履',
      ProductCategory.outerwear => '外层',
      ProductCategory.accessories => '配饰',
      _ => product.category,
    };
  }
}

class _ProductTag extends StatelessWidget {
  const _ProductTag(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFFF0EEEA),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF625D57),
          fontSize: 9.5,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _FitReason extends StatelessWidget {
  const _FitReason({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 58,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF695A78),
                fontSize: 10,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: Color(0xFF4E4854),
                fontSize: 10.5,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
