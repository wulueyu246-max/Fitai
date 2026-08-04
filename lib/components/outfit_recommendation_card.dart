import 'package:flutter/material.dart';

import '../models/product.dart';
import 'product_grid.dart';
import 'try_on_button.dart';

class OutfitRecommendationCard extends StatelessWidget {
  const OutfitRecommendationCard({
    required this.products,
    required this.selectedProductIds,
    required this.onProductTap,
    required this.onViewDetails,
    this.onProductTryOn,
    required this.favoriteProductIds,
    required this.onFavorite,
    required this.onTryOn,
    this.isLoading = false,
    this.errorMessage,
    this.onRetry,
    this.tryingOnProductId,
    super.key,
  });

  final List<Product> products;
  final Set<String> selectedProductIds;
  final ValueChanged<Product> onProductTap;
  final ValueChanged<Product> onViewDetails;
  final ValueChanged<Product>? onProductTryOn;
  final Set<String> favoriteProductIds;
  final ValueChanged<Product> onFavorite;
  final VoidCallback? onTryOn;
  final bool isLoading;
  final String? errorMessage;
  final VoidCallback? onRetry;
  final String? tryingOnProductId;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: const BoxDecoration(
                  color: Color(0xFFE3EBE1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.shopping_bag_outlined,
                  size: 20,
                  color: Color(0xFF244C3A),
                ),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '为你匹配的单品',
                      style: TextStyle(
                        color: Color(0xFF1E1C1A),
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      '点击卡片选择，同类商品会自动替换',
                      style: TextStyle(
                        color: Color(0xFF807A75),
                        fontSize: 12.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (isLoading)
            const Padding(
              key: Key('product-recommendation-loading'),
              padding: EdgeInsets.symmetric(vertical: 54),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(strokeWidth: 2.5),
                    SizedBox(height: 14),
                    Text(
                      '正在根据分析结果匹配商品...',
                      style: TextStyle(color: Color(0xFF77716C)),
                    ),
                  ],
                ),
              ),
            )
          else if (errorMessage != null && products.isEmpty)
            Padding(
              key: const Key('product-recommendation-error'),
              padding: const EdgeInsets.symmetric(vertical: 38),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.cloud_off_outlined,
                      color: Color(0xFF8A7563),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      errorMessage!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Color(0xFF77716C)),
                    ),
                    const SizedBox(height: 14),
                    OutlinedButton.icon(
                      key: const Key('retry-product-recommendations'),
                      onPressed: onRetry,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('重新匹配'),
                    ),
                  ],
                ),
              ),
            )
          else if (products.isEmpty)
            const Padding(
              key: Key('product-recommendation-empty'),
              padding: EdgeInsets.symmetric(vertical: 42),
              child: Center(child: Text('暂时没有匹配的商品')),
            )
          else ...[
            const Text(
              '按穿搭位置浏览商品，点击即可选择对应单品',
              style: TextStyle(
                color: Color(0xFF817B75),
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 18),
            for (final slot in ProductCategory.values)
              _ProductCategorySection(
                slot: slot,
                products: products
                    .where((product) => product.wardrobeSlot == slot)
                    .take(2)
                    .toList(growable: false),
                selectedProductIds: selectedProductIds,
                onProductTap: onProductTap,
                onViewDetails: onViewDetails,
                onProductTryOn: onProductTryOn,
                favoriteProductIds: favoriteProductIds,
                onFavorite: onFavorite,
                tryingOnProductId: tryingOnProductId,
              ),
            if (onTryOn != null) ...[
              const SizedBox(height: 20),
              Text(
                '已选择 ${selectedProductIds.length} 件单品',
                style: const TextStyle(
                  color: Color(0xFF716B66),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                '虚拟试穿入口',
                style: TextStyle(
                  color: Color(0xFF2A2724),
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 10),
              TryOnButton(
                onPressed: tryingOnProductId == null ? onTryOn : null,
                isLoading: tryingOnProductId != null,
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _ProductCategorySection extends StatelessWidget {
  const _ProductCategorySection({
    required this.slot,
    required this.products,
    required this.selectedProductIds,
    required this.onProductTap,
    required this.onViewDetails,
    required this.onProductTryOn,
    required this.favoriteProductIds,
    required this.onFavorite,
    required this.tryingOnProductId,
  });

  final String slot;
  final List<Product> products;
  final Set<String> selectedProductIds;
  final ValueChanged<Product> onProductTap;
  final ValueChanged<Product> onViewDetails;
  final ValueChanged<Product>? onProductTryOn;
  final Set<String> favoriteProductIds;
  final ValueChanged<Product> onFavorite;
  final String? tryingOnProductId;

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: Key('product-section-$slot'),
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            ProductCategory.label(slot),
            style: const TextStyle(
              color: Color(0xFF2A2724),
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 10),
          if (products.isEmpty)
            const Text(
              '暂时没有匹配单品',
              style: TextStyle(color: Color(0xFF817B75), fontSize: 12),
            )
          else
            ProductGrid(
              products: products,
              selectedProductIds: selectedProductIds,
              onProductTap: onProductTap,
              onViewDetails: onViewDetails,
              onProductTryOn: onProductTryOn,
              favoriteProductIds: favoriteProductIds,
              onFavorite: onFavorite,
              tryingOnProductId: tryingOnProductId,
            ),
        ],
      ),
    );
  }
}
