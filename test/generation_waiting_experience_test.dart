import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:fit_ai/components/ai_generation_loading_panel.dart';
import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/models/app_location.dart';
import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:fit_ai/models/outfit_generation_state.dart';
import 'package:fit_ai/models/outfit_plan.dart';
import 'package:fit_ai/models/outfit_request.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/pages/ai_outfit_page.dart';
import 'package:fit_ai/repositories/outfit_repository.dart';
import 'package:fit_ai/services/ai_service.dart';
import 'package:fit_ai/services/body_photo_picker.dart';
import 'package:fit_ai/services/consent_service.dart';
import 'package:fit_ai/services/image_data_service.dart';
import 'package:fit_ai/services/location_service.dart';
import 'package:fit_ai/services/product_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as image;
import 'package:image_picker/image_picker.dart';

void main() {
  testWidgets('generation immediately shows animation and submits only once', (
    tester,
  ) async {
    final repository = _GatedOutfitRepository();
    final products = _GatedProductService();
    await _pumpPage(tester, repository: repository, productService: products);
    await _selectFrontPhoto(tester);

    await _tapGenerate(tester);
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.byKey(const Key('ai-generation-loading-panel')), findsOne);
    expect(find.byKey(const Key('ai-generation-spinner')), findsOne);
    expect(find.byKey(const Key('ai-generation-lottie')), findsOne);
    expect(find.byKey(const Key('ai-generation-linear-progress')), findsOne);
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('generate-outfit')),
    );
    expect(button.onPressed, isNull);
    expect(repository.calls, 1);

    tester.binding.handleAppLifecycleStateChanged(
      AppLifecycleState.inactive,
    );
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(
      AppLifecycleState.resumed,
    );
    await tester.pump(const Duration(seconds: 9));

    expect(repository.calls, 1);
    expect(find.text('正在生成穿搭方案'), findsOne);

    repository.complete();
    await tester.pump(const Duration(milliseconds: 80));
    expect(find.text('测试身体分析'), findsOne);
    expect(find.byKey(const Key('product-recommendation-loading')), findsOne);
    for (final slot in ProductCategory.values) {
      expect(find.byKey(Key('product-skeleton-$slot')), findsOne);
    }

    products.complete(MockProductDatabase.products);
    await tester.pump(const Duration(milliseconds: 450));
    expect(
      find.byKey(const Key('product-recommendation-loading')),
      findsNothing,
    );
    expect(repository.calls, 1);
  });

  testWidgets('missing Lottie asset falls back to a spinner', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: AiGenerationLoadingPanel(
            state: OutfitGenerationState.generatingOutfit,
            animationAsset: 'assets/animations/not-found.json',
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));

    expect(
      find.byKey(const Key('ai-generation-fallback-spinner')),
      findsOne,
    );
  });

  testWidgets('product failure keeps AI result and exposes retry', (
    tester,
  ) async {
    final repository = _ImmediateOutfitRepository();
    final productService = _FailingProductService();
    await _pumpPage(
      tester,
      repository: repository,
      productService: productService,
    );
    await _selectFrontPhoto(tester);
    await _tapGenerate(tester);
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('测试身体分析'), findsOne);
    expect(find.text('智能精选暂时不可用，点击重新匹配'), findsOne);
    expect(find.byKey(const Key('retry-product-recommendations')), findsOne);
    expect(find.byKey(const Key('generate-outfit')), findsOne);
    expect(repository.calls, 1);
    expect(productService.calls, 1);

    await tester.ensureVisible(
      find.byKey(const Key('retry-product-recommendations')),
    );
    await tester.tap(find.byKey(const Key('retry-product-recommendations')));
    await tester.pump(const Duration(milliseconds: 300));
    expect(repository.calls, 1);
    expect(productService.calls, 2);
    expect(find.text('测试身体分析'), findsOne);
  });

  testWidgets('empty product result keeps the Look and shows no-match state', (
    tester,
  ) async {
    final repository = _ImmediateOutfitRepository();
    final productService = _EmptyProductService();
    await _pumpPage(
      tester,
      repository: repository,
      productService: productService,
    );
    await _selectFrontPhoto(tester);
    await _tapGenerate(tester);
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('测试身体分析'), findsOne);
    expect(find.byKey(const Key('product-recommendation-empty')), findsOne);
    expect(find.byKey(const Key('product-recommendation-error')), findsNothing);
    expect(repository.calls, 1);
    expect(productService.calls, 1);
  });

  testWidgets(
      'Shopping Agent success displays candidate-backed Looks without legacy product call',
      (tester) async {
    final productService = _CountingProductService();
    await _pumpPage(
      tester,
      repository: _ShoppingAgentOutfitRepository(success: true),
      productService: productService,
    );
    await _selectFrontPhoto(tester);
    await _tapGenerate(tester);
    await tester.pump(const Duration(milliseconds: 500));

    expect(productService.calls, 0);
    expect(find.text('真实商品 Look 1'), findsWidgets);
    expect(find.text('真实商品 Look 2'), findsWidgets);
  });

  testWidgets(
      'Shopping Agent failure never falls back to legacy product recommendation',
      (tester) async {
    final productService = _CountingProductService();
    await _pumpPage(
      tester,
      repository: _ShoppingAgentOutfitRepository(success: false),
      productService: productService,
    );
    await _selectFrontPhoto(tester);
    await _tapGenerate(tester);
    await tester.pump(const Duration(milliseconds: 500));

    expect(productService.calls, 0);
    expect(find.text('本次智能选品未完成，请重新生成'), findsWidgets);
  });

  testWidgets('AI timeout stops loading and allows retry', (tester) async {
    final repository = _TimeoutOutfitRepository();
    await _pumpPage(tester, repository: repository);
    await _selectFrontPhoto(tester);
    await _tapGenerate(tester);
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.byKey(const Key('generation-timeout')), findsOne);
    expect(find.byKey(const Key('ai-generation-loading-panel')), findsNothing);
    expect(find.byKey(const Key('retry-outfit-generation')), findsOne);
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('generate-outfit')),
    );
    expect(button.onPressed, isNotNull);
  });

  test('large body photo is resized and compressed before Base64 upload',
      () async {
    final source = image.Image(width: 1800, height: 1800);
    for (var y = 0; y < source.height; y += 1) {
      for (var x = 0; x < source.width; x += 1) {
        source.setPixelRgb(
          x,
          y,
          (x * 17 + y * 31) % 256,
          (x * 47 + y * 13) % 256,
          (x * 7 + y * 61) % 256,
        );
      }
    }
    final original = Uint8List.fromList(image.encodePng(source));
    final service = ImageDataService();
    final result = await service.encodeImages({
      'front': XFile.fromData(
        original,
        path: 'large-body.png',
        name: 'large-body.png',
        mimeType: 'image/png',
      ),
    });

    expect(result['front'], startsWith('data:image/'));
    final compressed = base64Decode(result['front']!.split(',').last);
    final decoded = image.decodeImage(compressed);
    expect(decoded, isNotNull);
    expect(decoded!.width <= 1600 && decoded.height <= 1600, isTrue);
    expect(compressed.length, lessThanOrEqualTo(4 * 1024 * 1024));
  });
}

Future<void> _pumpPage(
  WidgetTester tester, {
  required OutfitRepository repository,
  ProductService? productService,
}) async {
  final consent = ConsentService();
  await consent.grantRequiredConsent();
  await tester.pumpWidget(
    MaterialApp(
      home: AiOutfitPage(
        repository: repository,
        productService:
            productService ?? const MockProductService(delay: Duration.zero),
        bodyPhotoPicker: _SinglePhotoPicker(),
        consentService: consent,
        locationService: const _NoopLocationService(),
      ),
    ),
  );
  await tester.pump();
}

Future<void> _selectFrontPhoto(WidgetTester tester) async {
  final picker = find.byKey(const Key('photo-gallery-picker'));
  await tester.ensureVisible(picker);
  await tester.tap(picker);
  await tester.pump(const Duration(milliseconds: 200));
  expect(find.byKey(const Key('remove-photo-front')), findsOne);
}

Future<void> _tapGenerate(WidgetTester tester) async {
  await tester.enterText(find.byKey(const Key('ai-height')), '170');
  await tester.enterText(find.byKey(const Key('ai-weight')), '60');
  final generate = find.byKey(const Key('generate-outfit'));
  await tester.ensureVisible(generate);
  await tester.tap(generate);
  await tester.pump();
}

const _analysis = OutfitAnalysis(
  bodyAnalysis: '测试身体分析',
  style: '简约通勤',
  top: '利落上衣',
  bottom: '直筒长裤',
  shoes: '轻量鞋履',
  accessories: '简洁配饰',
  suggestion: '保持舒适比例',
);

class _SinglePhotoPicker implements BodyPhotoPicker {
  @override
  Future<List<XFile>> pickFromGallery({int limit = 3}) async {
    const png =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    return [
      XFile.fromData(
        Uint8List.fromList(base64Decode(png)),
        path: 'front.png',
        name: 'front.png',
        mimeType: 'image/png',
      ),
    ];
  }

  @override
  Future<List<XFile>> retrieveLostGalleryImages() async => const [];
}

class _GatedOutfitRepository implements OutfitRepository {
  final Completer<void> _gate = Completer<void>();
  int calls = 0;

  void complete() => _gate.complete();

  @override
  Future<OutfitAnalysis> generateOutfit(OutfitRequest request) async {
    calls += 1;
    await _gate.future;
    return _analysis;
  }

  @override
  void close() {}
}

class _ImmediateOutfitRepository implements OutfitRepository {
  int calls = 0;

  @override
  Future<OutfitAnalysis> generateOutfit(OutfitRequest request) async {
    calls += 1;
    return _analysis;
  }

  @override
  void close() {}
}

class _TimeoutOutfitRepository implements OutfitRepository {
  @override
  Future<OutfitAnalysis> generateOutfit(OutfitRequest request) {
    throw const AIServiceException('AI 服务响应超时');
  }

  @override
  void close() {}
}

class _GatedProductService extends _BaseProductService {
  final Completer<List<Product>> _gate = Completer<List<Product>>();

  void complete(List<Product> products) => _gate.complete(products);

  @override
  Future<List<Product>> recommendProducts({
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) =>
      _gate.future;
}

class _FailingProductService extends _BaseProductService {
  int calls = 0;

  @override
  Future<List<Product>> recommendProducts({
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) {
    calls += 1;
    return Future.error(StateError('product unavailable'));
  }
}

class _EmptyProductService extends _BaseProductService {
  int calls = 0;

  @override
  Future<List<Product>> recommendProducts({
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) async {
    calls += 1;
    return const [];
  }
}

class _CountingProductService extends _BaseProductService {
  int calls = 0;

  @override
  Future<List<Product>> recommendProducts({
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) async {
    calls += 1;
    return MockProductDatabase.products;
  }
}

class _ShoppingAgentOutfitRepository implements OutfitRepository {
  _ShoppingAgentOutfitRepository({required this.success});

  final bool success;

  @override
  Future<OutfitAnalysis> generateOutfit(OutfitRequest request) async {
    if (!success) {
      return _analysis.copyWith(
        requestId: 'shopping-agent-failed',
        gender: 'unisex',
        shoppingAgentStatus: 'failed',
        shoppingAgentFirstFailureStage: 'product_selector',
        shoppingAgentRetryable: true,
      );
    }
    final products = _shoppingAgentProducts();
    OutfitPlan plan(int index) => OutfitPlan(
          id: 'shopping-plan-$index',
          title: '真实商品 Look $index',
          top: products.firstWhere(
            (product) => product.id == 'candidate-top-$index',
          ),
          bottom: products.firstWhere(
            (product) => product.id == 'candidate-bottom-$index',
          ),
          shoes: products.firstWhere(
            (product) => product.id == 'candidate-shoes-$index',
          ),
          reason: '真实候选组合',
          createdTime: DateTime(2026, 8, 17),
          gender: 'unisex',
          requestId: 'shopping-agent-success',
          lookId: 'shopping-look-$index',
          matchScore: 80,
        );
    final plans = [plan(1), plan(2)];
    return _analysis.copyWith(
      requestId: 'shopping-agent-success',
      gender: 'unisex',
      shoppingAgentStatus: 'success',
      recommendedProducts: products,
      outfitPlan: plans.first,
      outfitPlans: plans,
    );
  }

  @override
  void close() {}
}

List<Product> _shoppingAgentProducts() {
  Product product(String category, int index) {
    final source = MockProductDatabase.products.firstWhere(
      (item) => item.wardrobeSlot == category,
    );
    return source.copyWith(
      id: 'candidate-$category-$index',
      sku: 'candidate-$category-$index',
      name: '$category 真实商品 $index',
      sourceProvider: 'taobao',
      isMock: false,
      requestId: 'shopping-agent-success',
      lookId: 'shopping-look-$index',
    );
  }

  return [
    for (final index in [1, 2]) ...[
      product(ProductCategory.top, index),
      product(ProductCategory.bottom, index),
      product(ProductCategory.shoes, index),
    ],
  ];
}

abstract class _BaseProductService implements ProductService {
  @override
  Future<List<OutfitPlan>> createOutfitPlans({
    required List<Product> products,
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) async =>
      [
        await createOutfitPlan(
          products: products,
          analysis: analysis,
          request: request,
        ),
      ];

  @override
  Future<OutfitPlan> createOutfitPlan({
    required List<Product> products,
    required OutfitAnalysis analysis,
    required OutfitRequest request,
  }) async {
    Product slot(String category) => products.firstWhere(
          (product) => product.wardrobeSlot == category,
          orElse: () => MockProductDatabase.products.firstWhere(
            (product) => product.wardrobeSlot == category,
          ),
        );
    return OutfitPlan(
      id: 'test-plan',
      title: '测试方案',
      top: slot(ProductCategory.top),
      bottom: slot(ProductCategory.bottom),
      shoes: slot(ProductCategory.shoes),
      reason: analysis.suggestion,
      createdTime: DateTime(2026),
      scene: request.scene,
    );
  }

  @override
  Future<List<Product>> getCatalog() async => MockProductDatabase.products;

  @override
  Future<Product?> getProduct(String productId) async => null;

  @override
  Future<ProductCommerceInfo?> getCommerceInfo(String productId) async => null;

  @override
  Future<String?> getPurchaseLink(String productId) async => null;
}

class _NoopLocationService implements LocationService {
  const _NoopLocationService();

  @override
  Future<AppLocation?> load() async => null;

  @override
  Future<AppLocation> resolveCity(String city) => throw UnimplementedError();

  @override
  Future<void> save(AppLocation location) async {}

  @override
  Future<AppLocation> useDeviceLocation() => throw UnimplementedError();
}
