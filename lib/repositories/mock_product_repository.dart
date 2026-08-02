import '../data/mock_product_database.dart';
import '../models/product.dart';
import 'product_repository.dart';

/// Mutable in-memory Product table seeded with the bundled Mock catalog.
///
/// It is intentionally behind [ProductRepository], so the first commercial
/// catalog can later move to Supabase or an alliance feed without changing AI
/// recommendation and UI code.
class MockProductRepository implements ProductRepository {
  MockProductRepository({Iterable<Product>? seeds})
      : _records = {
          for (final product in seeds ?? MockProductDatabase.products)
            product.id: product,
        };

  static final MockProductRepository instance = MockProductRepository();

  final Map<String, Product> _records;

  @override
  Future<List<Product>> listProducts({
    String? brand,
    String? category,
    bool includeUnavailable = false,
  }) async {
    final normalizedBrand = brand?.trim().toLowerCase();
    final normalizedCategory = category?.trim();
    final values = _records.values.where((product) {
      if (!includeUnavailable && !product.isAvailable) return false;
      if (normalizedBrand != null &&
          normalizedBrand.isNotEmpty &&
          product.brand.toLowerCase() != normalizedBrand) {
        return false;
      }
      if (normalizedCategory != null &&
          normalizedCategory.isNotEmpty &&
          product.category != normalizedCategory) {
        return false;
      }
      return true;
    }).toList(growable: false);
    return List<Product>.unmodifiable(values);
  }

  @override
  Future<Product?> getById(String id) async => _records[id.trim()];

  @override
  Future<Product?> getBySku(String sku) async {
    final normalized = sku.trim();
    for (final product in _records.values) {
      if (product.sku == normalized) return product;
    }
    return null;
  }

  @override
  Future<void> save(Product product) async {
    if (product.id.trim().isEmpty || product.name.trim().isEmpty) {
      throw const ProductRepositoryException('商品 ID 和名称不能为空');
    }
    _records[product.id] = product;
  }

  @override
  Future<void> setAvailability(String id, bool isAvailable) async {
    final product = _records[id.trim()];
    if (product == null) {
      throw ProductRepositoryException('商品不存在：$id');
    }
    _records[id] = product.copyWith(isAvailable: isAvailable);
  }
}
