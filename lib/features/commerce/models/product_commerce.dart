import '../../../models/product.dart';

enum ProductStockStatus {
  inStock,
  lowStock,
  outOfStock,
}

class ProductCommerce {
  const ProductCommerce({
    required this.product,
    required this.currentPrice,
    required this.stock,
    required this.stockStatus,
    required this.provider,
    required this.syncedAt,
    this.purchaseUri,
  });

  final Product product;
  final String currentPrice;
  final int stock;
  final ProductStockStatus stockStatus;
  final Uri? purchaseUri;
  final String provider;
  final DateTime syncedAt;

  bool get canPurchase =>
      stockStatus != ProductStockStatus.outOfStock && purchaseUri != null;

  static ProductStockStatus resolveStockStatus(int stock) {
    if (stock <= 0) {
      return ProductStockStatus.outOfStock;
    }
    return stock <= 5
        ? ProductStockStatus.lowStock
        : ProductStockStatus.inStock;
  }
}
