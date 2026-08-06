import 'package:flutter/material.dart';

import '../models/product.dart';
import 'product_card.dart';

class HorizontalProductCarousel extends StatelessWidget {
  const HorizontalProductCarousel({
    required this.products,
    required this.favoriteProductIds,
    required this.onFavorite,
    required this.onViewDetails,
    this.onTryOn,
    this.onAddToWardrobe,
    this.onBuy,
    super.key,
  });

  final List<Product> products;
  final Set<String> favoriteProductIds;
  final ValueChanged<Product> onFavorite;
  final ValueChanged<Product> onViewDetails;
  final ValueChanged<Product>? onTryOn;
  final ValueChanged<Product>? onAddToWardrobe;
  final ValueChanged<Product>? onBuy;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 820,
      child: ListView.separated(
        key: const Key('horizontal-product-carousel'),
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 12),
        itemCount: products.length,
        separatorBuilder: (_, __) => const SizedBox(width: 14),
        itemBuilder: (context, index) {
          final product = products[index];
          return SizedBox(
            width: 268,
            child: ProductCard(
              product: product,
              selected: false,
              favorite: favoriteProductIds.contains(product.id),
              onFavorite: () => onFavorite(product),
              onViewDetails: () => onViewDetails(product),
              onTryOn: onTryOn == null ? null : () => onTryOn!(product),
              onAddToWardrobe: onAddToWardrobe == null
                  ? null
                  : () => onAddToWardrobe!(product),
              onBuy: onBuy == null ? null : () => onBuy!(product),
            ),
          );
        },
      ),
    );
  }
}
