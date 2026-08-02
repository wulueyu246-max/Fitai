import '../../../models/product.dart';
import '../../../services/brand_product_service.dart';
import '../models/product_commerce.dart';
import 'product_commerce_repository.dart';

class MockProductCommerceRepository implements ProductCommerceRepository {
  const MockProductCommerceRepository({
    this.service = const MockBrandProductService(),
  });

  final BrandProductService service;

  @override
  Future<List<Product>> fetchCatalog({String? brand}) {
    return service.fetchProducts(brand: brand);
  }

  @override
  Future<Product?> getBySku(String sku) {
    return service.getProductBySku(sku);
  }

  @override
  Future<ProductCommerce?> getCommerce(String sku) async {
    final product = await service.getProductBySku(sku);
    if (product == null) {
      return null;
    }
    final stock = await service.getStock(sku);
    final currentPrice = await service.getCurrentPrice(sku);
    final purchaseUri = await service.getPurchaseUri(sku);
    return ProductCommerce(
      product: product,
      currentPrice: currentPrice,
      stock: stock,
      stockStatus: ProductCommerce.resolveStockStatus(stock),
      purchaseUri: purchaseUri,
      provider: 'mock-brand-catalog',
      syncedAt: DateTime.now(),
    );
  }

  @override
  Future<void> confirmMockPurchase({
    required String sku,
    required String orderId,
  }) async {
    if (await service.getProductBySku(sku) == null) {
      throw ArgumentError.value(sku, 'sku', 'Unknown product SKU');
    }
    // V1 only confirms the commerce boundary. No payment or stock is changed.
  }
}
