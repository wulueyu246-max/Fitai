import '../data/mock_product_database.dart';
import '../models/brand.dart';
import '../models/product.dart';

abstract interface class BrandService {
  Future<List<Brand>> getBrands();

  Future<List<Product>> getBrandProducts(String brandId);

  Future<void> synchronizeCatalog(String brandId);
}

class MockBrandService implements BrandService {
  const MockBrandService({this.delay = const Duration(milliseconds: 180)});

  final Duration delay;

  static const _brands = [
    Brand(
      id: 'uniqlo',
      name: 'UNIQLO',
      shortName: 'U',
      supportedCategories: ProductCategory.catalogValues,
      apiAvailable: false,
    ),
    Brand(
      id: 'nike',
      name: 'Nike',
      shortName: 'N',
      supportedCategories: ProductCategory.catalogValues,
      apiAvailable: false,
    ),
    Brand(
      id: 'adidas',
      name: 'Adidas',
      shortName: 'A',
      supportedCategories: ProductCategory.catalogValues,
      apiAvailable: false,
    ),
    Brand(
      id: 'zara',
      name: 'ZARA',
      shortName: 'Z',
      supportedCategories: ProductCategory.catalogValues,
      apiAvailable: false,
    ),
    Brand(
      id: 'cos',
      name: 'COS',
      shortName: 'C',
      supportedCategories: ProductCategory.catalogValues,
      apiAvailable: false,
    ),
  ];

  @override
  Future<List<Brand>> getBrands() async {
    await _wait();
    return _brands;
  }

  @override
  Future<List<Product>> getBrandProducts(String brandId) async {
    await _wait();
    final brand = _brands.firstWhere((item) => item.id == brandId);
    return MockProductDatabase.products
        .where(
          (product) =>
              product.brand.toLowerCase() == brand.name.toLowerCase() ||
              (brand.id == 'uniqlo' && product.brand == '优衣库'),
        )
        .toList(growable: false);
  }

  @override
  Future<void> synchronizeCatalog(String brandId) async {
    await _wait();
    if (!_brands.any((brand) => brand.id == brandId)) {
      throw ArgumentError.value(brandId, 'brandId', '未知品牌');
    }
  }

  Future<void> _wait() {
    return delay == Duration.zero
        ? Future<void>.value()
        : Future<void>.delayed(delay);
  }
}
