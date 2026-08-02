import 'package:flutter/material.dart';

import '../models/product.dart';
import 'product_card.dart';

class ProductGrid extends StatelessWidget {
  const ProductGrid({
    required this.products,
    required this.selectedProductIds,
    required this.onProductTap,
    required this.onViewDetails,
    this.onProductTryOn,
    required this.favoriteProductIds,
    required this.onFavorite,
    this.tryingOnProductId,
    this.onAddToWardrobe,
    this.onBuy,
    super.key,
  });

  final List<Product> products;
  final Set<String> selectedProductIds;
  final ValueChanged<Product> onProductTap;
  final ValueChanged<Product> onViewDetails;
  final ValueChanged<Product>? onProductTryOn;
  final Set<String> favoriteProductIds;
  final ValueChanged<Product> onFavorite;
  final String? tryingOnProductId;
  final ValueChanged<Product>? onAddToWardrobe;
  final ValueChanged<Product>? onBuy;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columnCount = constraints.maxWidth >= 680 ? 2 : 1;
        final rowCount = (products.length / columnCount).ceil();

        return ListView.builder(
          key: const Key('product-recommendation-grid'),
          shrinkWrap: true,
          primary: false,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: rowCount,
          itemBuilder: (context, rowIndex) {
            return Padding(
              padding: EdgeInsets.only(
                bottom: rowIndex == rowCount - 1 ? 0 : 16,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (var columnIndex = 0;
                      columnIndex < columnCount;
                      columnIndex++) ...[
                    if (columnIndex > 0) const SizedBox(width: 14),
                    Expanded(
                      child: _buildProduct(
                        rowIndex * columnCount + columnIndex,
                      ),
                    ),
                  ],
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildProduct(int index) {
    if (index >= products.length) {
      return const SizedBox.shrink();
    }

    final product = products[index];
    return ProductCard(
      product: product,
      selected: selectedProductIds.contains(product.id),
      onTap: () => onProductTap(product),
      onViewDetails: () => onViewDetails(product),
      onTryOn: onProductTryOn == null || tryingOnProductId != null
          ? null
          : () => onProductTryOn!(product),
      favorite: favoriteProductIds.contains(product.id),
      onFavorite: () => onFavorite(product),
      onAddToWardrobe:
          onAddToWardrobe == null ? null : () => onAddToWardrobe!(product),
      onBuy: onBuy == null ? null : () => onBuy!(product),
      isTryOnLoading: tryingOnProductId == product.id,
    );
  }
}
