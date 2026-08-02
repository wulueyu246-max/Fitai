import 'package:fit_ai/components/outfit_recommendation_card.dart';
import 'package:fit_ai/models/outfit.dart';
import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:fit_ai/models/outfit_request.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/models/try_on_request.dart';
import 'package:fit_ai/pages/model_page.dart';
import 'package:fit_ai/services/product_service.dart';
import 'package:fit_ai/services/user_profile_service.dart';
import 'package:fit_ai/services/virtual_try_on_api.dart';
import 'package:fit_ai/services/virtual_try_on_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const productService = MockProductService(delay: Duration.zero);
  const tryOnService = MockVirtualTryOnService(
    delay: Duration.zero,
    generationDelay: Duration(seconds: 2),
  );
  const analysis = OutfitAnalysis(
    bodyAnalysis: '肩部线条偏窄，整体比例均衡',
    style: '商务极简',
    top: '结构感上衣',
    bottom: '高腰直筒裤',
    shoes: '窄长鞋型',
    accessories: '简洁腕表',
    suggestion: '保持深浅层次',
  );
  const request = OutfitRequest(
    height: 178,
    weight: 68,
    scene: '通勤',
    request: '商务会议',
    images: {},
  );

  Future<List<Product>> loadProducts() {
    return productService.recommendProducts(
      analysis: analysis,
      request: request,
    );
  }

  test('mock product service returns complete structured products', () async {
    final products = await loadProducts();
    final blazer = products.firstWhere(
      (product) => product.id == 'uniqlo-tailored-blazer',
    );
    final catalog = await productService.getCatalog();
    final commerce = await productService.getCommerceInfo(blazer.id);

    expect(products, hasLength(12));
    expect(catalog.length, greaterThanOrEqualTo(50));
    expect(blazer.id, 'uniqlo-tailored-blazer');
    expect(blazer.sku, startsWith('FITAI-'));
    expect(commerce?.inStock, isTrue);
    expect(commerce?.currentPrice, blazer.price);
    expect(blazer.brand, 'Uniqlo');
    expect(blazer.category, ProductCategory.outerwear);
    expect(blazer.imageUrl, endsWith('tailored_blazer.jpg'));
    expect(blazer.aiReason, contains('肩部比例'));
    expect(blazer.toJson()['aiReason'], blazer.aiReason);
    expect(
      blazer.toJson().keys,
      containsAll([
        'brand',
        'sku',
        'name',
        'imageUrl',
        'price',
        'category',
        'aiReason',
        'season',
        'fitType',
        'tryOnAvailable',
        'size',
        'material',
        'buyUrl',
        'stock',
      ]),
    );

    final connectedAnalysis = analysis.copyWith(
      recommendedProducts: products,
    );
    expect(connectedAnalysis.recommendedProducts, hasLength(12));
    expect(
      connectedAnalysis.toJson()['recommended_products'],
      isA<List<dynamic>>(),
    );
  });

  test('virtual try-on replaces a product in the same category', () async {
    final products = await productService.getCatalog();
    final shirt = products.firstWhere(
      (product) => product.id == 'cos-structured-shirt',
    );
    final knit = products.firstWhere(
      (product) => product.id == 'ralph-lauren-navy-knit',
    );
    final outfit = Outfit(
      height: request.height,
      weight: request.weight,
      bodyType: analysis.bodyAnalysis,
      style: analysis.style,
      userImages: request.images,
      products: [shirt],
    );

    final model = await tryOnService.createModel(outfit);
    final updated = await tryOnService.tryOn(model: model, product: knit);

    expect(
      updated.outfit.productForCategory(ProductCategory.top)?.id,
      knit.id,
    );
    expect(updated.outfit.products, hasLength(1));
  });

  test('virtual try-on exposes submit and status polling contracts', () async {
    const pollingService = MockVirtualTryOnService(
      delay: Duration.zero,
      generationDelay: Duration.zero,
    );
    final products = await loadProducts();
    final plan = await productService.createOutfitPlan(
      products: products,
      analysis: analysis,
      request: request,
    );
    final outfit = Outfit(
      height: request.height,
      weight: request.weight,
      bodyType: analysis.bodyAnalysis,
      style: analysis.style,
      userImages: request.images,
      products: plan.products,
    );
    final model = await pollingService.generateVirtualModel(outfit);
    final api = ServiceBackedVirtualTryOnAPI(pollingService);
    final task = await api.createTask(
      TryOnRequest(
        userId: 'polling-test-user',
        virtualModel: model,
        products: plan.products,
        outfitPlan: plan,
        userProfile: UserProfileService.defaultProfile,
        userImage: '',
        createdTime: DateTime(2026, 7, 30),
      ),
    );
    final completed = await api.getTaskStatus(task.id);
    final result = await api.getResult(task.id);

    expect(task.status.name, 'waiting');
    expect(completed.status.name, 'success');
    expect(completed.imageUrl, isNotEmpty);
    expect(completed.error, isNull);
    expect(result.image, completed.imageUrl);
  });

  testWidgets('recommendation module exposes selected products to try-on', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(800, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final products = await loadProducts();
    var startedTryOn = false;
    Product? viewedProduct;
    Product? focusedProduct;
    final selectedIds = {
      products.first.id,
      products[1].id,
    };

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: OutfitRecommendationCard(
              products: products,
              selectedProductIds: selectedIds,
              onProductTap: (_) {},
              onViewDetails: (product) => viewedProduct = product,
              onProductTryOn: (product) => focusedProduct = product,
              favoriteProductIds: const {},
              onFavorite: (_) {},
              onTryOn: () => startedTryOn = true,
            ),
          ),
        ),
      ),
    );

    expect(
      find.byKey(const Key('product-recommendation-grid')),
      findsOneWidget,
    );
    expect(find.text(products.first.name), findsOneWidget);
    expect(find.text(products.first.aiReason), findsOneWidget);
    expect(find.text('已选择 2 件单品'), findsOneWidget);

    final firstProductTryOn = find.byKey(
      Key('try-on-${products.first.id}'),
    );
    await tester.ensureVisible(firstProductTryOn);
    await tester.tap(firstProductTryOn);

    expect(focusedProduct?.id, products.first.id);

    final firstProductDetails = find.byKey(
      Key('details-${products.first.id}'),
    );
    await tester.ensureVisible(firstProductDetails);
    await tester.tap(firstProductDetails);

    expect(viewedProduct?.id, products.first.id);

    final tryOnAllButton = find.byKey(const Key('ai-try-on-button'));
    await tester.ensureVisible(tryOnAllButton);
    await tester.tap(tryOnAllButton);

    expect(startedTryOn, isTrue);
  });

  testWidgets('outfit session loads model page and switches the top', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final products = await productService.getCatalog();
    final shirt = products.firstWhere(
      (product) => product.id == 'cos-structured-shirt',
    );
    final blazer = products.firstWhere(
      (product) => product.id == 'uniqlo-tailored-blazer',
    );
    final trousers = products.firstWhere(
      (product) => product.category == ProductCategory.bottom,
    );
    final shoes = products.firstWhere(
      (product) => product.category == ProductCategory.shoes,
    );
    final watch = products.firstWhere(
      (product) => product.category == ProductCategory.accessories,
    );
    final outfit = Outfit(
      height: request.height,
      weight: request.weight,
      bodyType: analysis.bodyAnalysis,
      style: analysis.style,
      userImages: request.images,
      products: [blazer, shirt, trousers, shoes, watch],
    );
    final model = await tryOnService.createModel(outfit);
    final outfitPlan = await productService.createOutfitPlan(
      products: products,
      analysis: analysis,
      request: request,
    );
    final session = ValueNotifier<TryOnRequest?>(null);
    var returnedToAiOutfit = false;
    addTearDown(session.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ModelPage(
          tryOnListenable: session,
          productService: productService,
          tryOnService: tryOnService,
          onBack: () => returnedToAiOutfit = true,
        ),
      ),
    );

    expect(
      find.text('请先在 AI穿搭 页面上传照片并生成方案，然后点击商品卡片中的“立即试穿”。'),
      findsOneWidget,
    );

    session.value = TryOnRequest(
      userId: 'test-user',
      virtualModel: model,
      products: [shirt, trousers, shoes],
      outfitPlan: outfitPlan.replaceProduct(shirt),
      userProfile: UserProfileService.defaultProfile,
      userImage: 'mock-user-image',
      createdTime: DateTime(2026, 7, 29),
    );
    await tester.pumpAndSettle();

    expect(find.text('我的AI模特'), findsOneWidget);
    expect(find.byKey(const Key('virtual-try-on-guide')), findsOneWidget);
    expect(find.text('当前选择商品'), findsOneWidget);
    expect(find.text('穿搭说明'), findsOneWidget);
    expect(find.text('当前穿搭方案'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('selected-try-on-product')),
        matching: find.text('结构感精纺棉衬衫'),
      ),
      findsOneWidget,
    );
    final productDetailsButton = find.byKey(
      const Key('model-view-product-detail'),
    );
    await tester.ensureVisible(productDetailsButton);
    await tester.tap(productDetailsButton);
    await tester.pumpAndSettle();
    expect(find.text('AI为什么推荐'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();

    final saveButton = find.text('保存搭配');
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pump();
    expect(find.text('已保存'), findsOneWidget);

    final generateButton = find.byKey(
      const Key('generate-try-on-button'),
    );
    await tester.ensureVisible(generateButton);
    await tester.tap(generateButton);
    await tester.pump();

    expect(find.text('试穿任务已进入队列'), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 250));
    expect(find.text('正在生成试穿效果...'), findsOneWidget);

    for (var index = 0; index < 7; index++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    await tester.pumpAndSettle();

    expect(find.text('试穿生成结果'), findsOneWidget);
    expect(find.text('Mock 结果'), findsOneWidget);
    expect(find.byKey(const Key('try-on-result-image')), findsOneWidget);
    expect(find.byKey(const Key('share-try-on-result')), findsOneWidget);

    final saveResultButton = find.byKey(const Key('save-try-on-result'));
    await tester.ensureVisible(saveResultButton);
    expect(
      find.descendant(
        of: saveResultButton,
        matching: find.text('保存结果'),
      ),
      findsOneWidget,
    );
    await tester.tap(saveResultButton);
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: saveResultButton,
        matching: find.text('已保存'),
      ),
      findsOneWidget,
    );

    final knitFinder = find.byKey(
      const Key('product-ralph-lauren-navy-knit'),
    );
    await tester.ensureVisible(knitFinder);
    await tester.tap(knitFinder);
    await tester.pumpAndSettle();

    expect(
      find.descendant(
        of: find.byKey(const Key('selected-try-on-product')),
        matching: find.text('精纺圆领针织衫'),
      ),
      findsOneWidget,
    );
    final backButton = find.byKey(const Key('model-back-button'));
    await tester.ensureVisible(backButton);
    await tester.pumpAndSettle();
    await tester.tap(backButton);
    expect(returnedToAiOutfit, isTrue);
  });
}
