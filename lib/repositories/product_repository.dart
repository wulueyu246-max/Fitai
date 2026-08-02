import '../models/product.dart';

/// Product table boundary used by the recommendation, management and commerce
/// layers. A future cloud implementation can replace the Mock repository
/// without changing pages or recommendation rules.
abstract interface class ProductRepository {
  Future<List<Product>> listProducts({
    String? brand,
    String? category,
    bool includeUnavailable = false,
  });

  Future<Product?> getById(String id);

  Future<Product?> getBySku(String sku);

  Future<void> save(Product product);

  Future<void> setAvailability(String id, bool isAvailable);
}

class ProductRepositoryException implements Exception {
  const ProductRepositoryException(this.message);

  final String message;

  @override
  String toString() => message;
}
