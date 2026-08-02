import '../models/product.dart';
import '../repositories/product_repository.dart';

enum AllianceProvider { jingdong, taobao }

class AllianceProductPage {
  const AllianceProductPage({required this.products, this.nextCursor});

  final List<Product> products;
  final String? nextCursor;
}

/// Adapter contract reserved for JD Alliance and Taobao Alliance.
/// Implementations own authentication/signing and map provider payloads into
/// the shared [Product] model. No live provider is connected in this version.
abstract interface class AllianceProductAdapter {
  AllianceProvider get provider;

  Future<AllianceProductPage> fetchPage({String? cursor});
}

class ProductCatalogSyncService {
  const ProductCatalogSyncService({required this.repository});

  final ProductRepository repository;

  Future<int> synchronize(AllianceProductAdapter adapter) async {
    var imported = 0;
    String? cursor;
    do {
      final page = await adapter.fetchPage(cursor: cursor);
      for (final product in page.products) {
        await repository.save(product);
        imported += 1;
      }
      cursor = page.nextCursor;
    } while (cursor != null && cursor.isNotEmpty);
    return imported;
  }
}
