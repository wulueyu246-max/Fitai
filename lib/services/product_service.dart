import '../core/logging/app_logger.dart';
import '../models/outfit_analysis.dart';
import '../models/outfit_plan.dart';
import '../models/outfit_request.dart';
import '../models/product.dart';
import '../repositories/mock_product_repository.dart';
import '../repositories/product_repository.dart';
import 'brand_product_service.dart';
import 'recommendation_service.dart';

class ProductCommerceInfo {
  const ProductCommerceInfo({
    required this.productId,
    required this.currentPrice,
    required this.inStock,
    this.purchaseUrl,
  });

  final String productId;
  final String currentPrice;
  final bool inStock;
  final Uri? purchaseUrl;
}

abstract interface class ProductService {
  Future<List<Product>> recommendProducts({
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  });

  Future<List<Product>> getCatalog();

  Future<Product?> getProduct(String productId);

  Future<String?> getPurchaseLink(String productId);

  /// Commerce boundary reserved for live price, inventory and checkout APIs.
  Future<ProductCommerceInfo?> getCommerceInfo(String productId);

  Future<OutfitPlan> createOutfitPlan({
    required List<Product> products,
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  });

  Future<List<OutfitPlan>> createOutfitPlans({
    required List<Product> products,
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  });
}

class MockProductService implements ProductService {
  const MockProductService({
    this.delay = const Duration(milliseconds: 260),
    this.recommendationService = const RecommendationService(),
    this.repository,
  });

  final Duration delay;
  final RecommendationService recommendationService;
  final ProductRepository? repository;

  ProductRepository get _repository =>
      repository ?? MockProductRepository.instance;

  @override
  Future<List<Product>> recommendProducts({
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) async {
    await _waitForMockDelay();
    final catalog = await _repository.listProducts();
    return recommendationService.recommendProducts(
      height: request.height,
      weight: request.weight,
      bodyType: analysis.bodyAnalysis,
      shoulderRatio: analysis.bodyAnalysis,
      legRatio: analysis.bodyAnalysis,
      style: analysis.style,
      scene: request.scene,
      catalog: catalog,
    );
  }

  @override
  Future<List<Product>> getCatalog() async {
    await _waitForMockDelay();
    return _repository.listProducts();
  }

  @override
  Future<Product?> getProduct(String productId) async {
    await _waitForMockDelay();
    return _repository.getById(productId);
  }

  @override
  Future<String?> getPurchaseLink(String productId) async {
    await _waitForMockDelay();
    final product = await _repository.getById(productId);
    if (product == null || product.buyUrl.isEmpty) {
      return null;
    }
    return product.buyUrl;
  }

  @override
  Future<ProductCommerceInfo?> getCommerceInfo(String productId) async {
    final product = await getProduct(productId);
    if (product == null) {
      return null;
    }
    return ProductCommerceInfo(
      productId: product.id,
      currentPrice: product.price,
      inStock: product.isAvailable && product.inStock,
      purchaseUrl: product.buyUrl.isEmpty ? null : Uri.tryParse(product.buyUrl),
    );
  }

  @override
  Future<OutfitPlan> createOutfitPlan({
    required List<Product> products,
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) async {
    await _waitForMockDelay();
    return recommendationService.buildOutfitPlan(
      products: products,
      style: analysis.style,
      scene: request.scene,
      requestId: analysis.requestId ?? '',
      gender: analysis.gender,
    );
  }

  @override
  Future<List<OutfitPlan>> createOutfitPlans({
    required List<Product> products,
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) async {
    await _waitForMockDelay();
    if (analysis.looks.isEmpty) {
      return [
        await createOutfitPlan(
          products: products,
          analysis: analysis,
          request: request,
        ),
      ];
    }
    return recommendationService.buildOutfitPlans(
      products: products,
      looks: analysis.looks,
      requestId: analysis.requestId ?? '',
      gender: analysis.gender,
    );
  }

  Future<void> _waitForMockDelay() {
    return delay == Duration.zero
        ? Future<void>.value()
        : Future<void>.delayed(delay);
  }
}

class CatalogProductService implements ProductService {
  const CatalogProductService({
    required this.source,
    this.recommendationService = const RecommendationService(),
  });

  final BrandProductService source;
  final RecommendationService recommendationService;

  @override
  Future<List<Product>> recommendProducts({
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) async {
    final hasStructuredRequirements = analysis.productRequirements.isNotEmpty;
    if (!hasStructuredRequirements) {
      AppLogger.instance.warning(
        'structured_product_requirements_missing',
        metadata: {
          'requestId': analysis.requestId,
          'lookCount': analysis.looks.length,
        },
      );
      return const [];
    }
    AppLogger.instance.info(
      'product_search_requirements_prepared',
      metadata: {
        'aiGender': analysis.gender,
        'requestGender': request.gender,
        'requirements': analysis.productRequirements
            .map(
              (requirement) => {
                'lookId': requirement.lookId,
                'searchRequirementGender': requirement.gender,
                'searchKeywords': requirement.searchKeywords,
                'category': requirement.category,
                'itemName': requirement.itemName,
                'fit': requirement.fit,
                'material': requirement.material,
                'queryReason': requirement.queryReason,
                'sourceElements': requirement.sourceElements,
              },
            )
            .toList(growable: false),
      },
    );
    final catalog = await source.fetchProducts(
      recommendationContext: {
        if (analysis.requestId?.trim().isNotEmpty ?? false)
          'request_id': analysis.requestId!.trim(),
        'user_input': request.request.trim(),
        'gender': analysis.gender,
        'style_expression': analysis.styleExpression,
        'style_semantics': analysis.styleSemantics.toJson(),
        'style_profile': analysis.styleProfile.toJson(),
        'outfit_blueprint': analysis.outfitBlueprint.toJson(),
        'style': analysis.style,
        'scene': request.scene,
        'budget': _itemBudgetCeiling(
          request.itemBudget,
          request.request,
        ),
        'item_budget': request.itemBudget,
        'outfit_budget': request.outfitBudget,
        'user_profile': {
          'gender': analysis.gender,
          'style_expression': analysis.styleExpression,
          'style_semantics': analysis.styleSemantics.toJson(),
          'style_profile': analysis.styleProfile.toJson(),
          'outfit_blueprint': analysis.outfitBlueprint.toJson(),
          'height': request.height,
          'weight': request.weight,
          'body_profile': analysis.bodyAnalysis,
          'styling_strategy': analysis.stylingStrategy.toJson(),
          'item_budget': request.itemBudget,
          'outfit_budget': request.outfitBudget,
        },
        'user_requirements': {
          'scene': request.scene,
          'style': analysis.style,
          'style_semantics': analysis.styleSemantics.toJson(),
          'style_profile': analysis.styleProfile.toJson(),
          'outfit_blueprint': analysis.outfitBlueprint.toJson(),
          'budget': _itemBudgetCeiling(
            request.itemBudget,
            request.request,
          ),
          'item_budget': request.itemBudget,
          'outfit_budget': request.outfitBudget,
        },
        'outfit_plan': {
          'style_semantics': analysis.styleSemantics.toJson(),
          'style_profile': analysis.styleProfile.toJson(),
          'outfit_blueprint': analysis.outfitBlueprint.toJson(),
          'styling_strategy': analysis.stylingStrategy.toJson(),
          'looks': analysis.looks
              .map((look) => look.toJson())
              .toList(growable: false),
          'top': analysis.top,
          'bottom': analysis.bottom,
          'shoes': analysis.shoes,
          'accessories': analysis.accessories,
          'summary': analysis.suggestion,
        },
        'looks':
            analysis.looks.map((look) => look.toJson()).toList(growable: false),
        'items': analysis.productRequirements
            .map((requirement) => requirement.toJson())
            .toList(growable: false),
      },
    );
    return catalog;
  }

  @override
  Future<List<Product>> getCatalog() => source.fetchProducts();

  @override
  Future<Product?> getProduct(String productId) async {
    final catalog = await source.fetchProducts();
    for (final product in catalog) {
      if (product.id == productId) {
        return product;
      }
    }
    return null;
  }

  @override
  Future<String?> getPurchaseLink(String productId) async {
    return (await getProduct(productId))?.purchaseUrl;
  }

  @override
  Future<ProductCommerceInfo?> getCommerceInfo(String productId) async {
    final product = await getProduct(productId);
    if (product == null) {
      return null;
    }
    return ProductCommerceInfo(
      productId: product.id,
      currentPrice: product.price,
      inStock: product.isAvailable && product.inStock,
      purchaseUrl: Uri.tryParse(product.purchaseUrl),
    );
  }

  @override
  Future<OutfitPlan> createOutfitPlan({
    required List<Product> products,
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) async {
    return recommendationService.buildOutfitPlan(
      products: products,
      style: analysis.style,
      scene: request.scene,
      requestId: analysis.requestId ?? '',
      gender: analysis.gender,
      lookId: analysis.outfitPlan?.lookId ??
          (analysis.looks.isEmpty ? '' : analysis.looks.first.lookId),
    );
  }

  @override
  Future<List<OutfitPlan>> createOutfitPlans({
    required List<Product> products,
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) async {
    if (analysis.looks.isEmpty) {
      return [
        await createOutfitPlan(
          products: products,
          analysis: analysis,
          request: request,
        ),
      ];
    }
    return recommendationService.buildOutfitPlans(
      products: products,
      looks: analysis.looks,
      requestId: analysis.requestId ?? '',
      gender: analysis.gender,
    );
  }
}

double _budgetFromRequest(String request) {
  final match =
      RegExp(r'(?:预算|不超过|以内)\s*[¥￥]?\s*(\d+(?:\.\d+)?)').firstMatch(request);
  return double.tryParse(match?.group(1) ?? '') ?? 0;
}

double _itemBudgetCeiling(String itemBudget, String request) {
  final explicitBudget = _budgetFromRequest(request);
  if (explicitBudget > 0) return explicitBudget;
  return switch (itemBudget.trim()) {
    '<50' => 50,
    '50-200' => 200,
    '200-500' => 500,
    '500-1000' => 1000,
    _ => 0,
  };
}
