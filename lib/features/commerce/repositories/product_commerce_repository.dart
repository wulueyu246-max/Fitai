import '../../../models/product.dart';
import '../models/product_commerce.dart';

abstract interface class ProductCommerceRepository {
  Future<List<Product>> fetchCatalog({String? brand});

  Future<Product?> getBySku(String sku);

  Future<ProductCommerce?> getCommerce(String sku);

  Future<void> confirmMockPurchase({
    required String sku,
    required String orderId,
  });
}
