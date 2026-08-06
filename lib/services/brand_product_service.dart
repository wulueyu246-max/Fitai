import '../models/product.dart';
import '../repositories/mock_product_repository.dart';
import '../repositories/product_repository.dart';

abstract interface class BrandProductService {
  Future<List<Product>> fetchProducts({
    String? brand,
    Map<String, dynamic>? recommendationContext,
  });

  Future<Product?> getProductBySku(String sku);

  Future<int> getStock(String sku);

  Future<String> getCurrentPrice(String sku);

  Future<Uri?> getPurchaseUri(String sku);
}

/// V1 使用本地商品库；真实品牌 API 接入时实现同一接口即可。
class MockBrandProductService implements BrandProductService {
  const MockBrandProductService({this.repository});

  final ProductRepository? repository;

  ProductRepository get _repository =>
      repository ?? MockProductRepository.instance;

  @override
  Future<List<Product>> fetchProducts({
    String? brand,
    Map<String, dynamic>? recommendationContext,
  }) async {
    final normalized = brand?.trim().toLowerCase();
    return _repository.listProducts(brand: normalized);
  }

  @override
  Future<Product?> getProductBySku(String sku) async {
    return _repository.getBySku(sku);
  }

  @override
  Future<int> getStock(String sku) async {
    final product = await getProductBySku(sku);
    return product?.isAvailable == true ? product!.stock : 0;
  }

  @override
  Future<String> getCurrentPrice(String sku) async {
    return (await getProductBySku(sku))?.price ?? '';
  }

  @override
  Future<Uri?> getPurchaseUri(String sku) async {
    final product = await getProductBySku(sku);
    final buyUrl = product?.isAvailable == true ? product!.buyUrl : '';
    return buyUrl.isEmpty ? null : Uri.tryParse(buyUrl);
  }
}
