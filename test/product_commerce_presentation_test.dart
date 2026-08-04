import 'package:fit_ai/components/outfit_recommendation_card.dart';
import 'package:fit_ai/components/product_card.dart';
import 'package:fit_ai/models/product.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Product product({
    String id = 'product-1',
    String category = ProductCategory.top,
    bool isMock = false,
    String purchaseUrl = 'https://shop.example.com/item',
    String imageUrl = 'assets/images/products/structured_shirt.jpg',
  }) {
    return Product(
      id: id,
      sku: 'SKU-$id',
      brand: '测试品牌',
      name: '结构感通勤上衣',
      category: category,
      imageUrl: imageUrl,
      color: '森林绿',
      size: 'S-XL',
      material: '棉',
      price: '299',
      buyUrl: purchaseUrl,
      stock: 1,
      description: '用于商品展示测试',
      style: '简约',
      season: '秋季',
      fitType: '合体',
      aiReason: '适合当前身材比例',
      originalPrice: '399',
      couponAmount: 20,
      shopName: '测试店铺',
      recommendationReason: '根据通勤场景与简约风格推荐',
      matchExplanation: '匹配上衣、森林绿和合体版型',
      isMock: isMock,
    );
  }

  test('parses the unified backend Mock product contract', () {
    final parsed = Product.fromJson({
      'product_id': 'mock-1',
      'title': '测试外套',
      'brand': '测试品牌',
      'category': '外套',
      'image_url': 'assets/images/products/tailored_blazer.jpg',
      'price': 399,
      'stock_status': 'in_stock',
      'platform': 'mock-catalog',
      'purchase_url': '',
      'is_mock': true,
      'original_price': null,
      'coupon_amount': 0,
      'recommendation_reason': '根据穿搭关键词匹配',
      'match_explanation': '匹配外套品类',
    });

    expect(parsed.id, 'mock-1');
    expect(parsed.name, '测试外套');
    expect(parsed.price, '399');
    expect(parsed.isMock, isTrue);
    expect(parsed.isPurchasable, isFalse);
    expect(parsed.recommendationReason, '根据穿搭关键词匹配');
  });

  test('normalizes legacy product category aliases', () {
    expect(ProductCategory.normalize('shirt'), ProductCategory.top);
    expect(ProductCategory.normalize('裤子'), ProductCategory.bottom);
    expect(ProductCategory.normalize('sneakers'), ProductCategory.shoes);
    expect(ProductCategory.normalize('jacket'), ProductCategory.outerwear);
    expect(ProductCategory.normalize('围巾'), ProductCategory.accessories);
  });

  test('only a real HTTPS URL is purchasable', () {
    expect(product().isPurchasable, isTrue);
    expect(product(purchaseUrl: '').isPurchasable, isFalse);
    expect(
      product(purchaseUrl: 'http://shop.example.com/item').isPurchasable,
      isFalse,
    );
    expect(product(isMock: true).isPurchasable, isFalse);
  });

  testWidgets('Mock product card shows review state and disables purchase', (
    tester,
  ) async {
    final mockProduct = product(isMock: true, purchaseUrl: '');
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 390,
              child: ProductCard(product: mockProduct, selected: false),
            ),
          ),
        ),
      ),
    );

    expect(find.text('测试商品数据，淘宝联盟功能审核中'), findsOneWidget);
    expect(find.text('测试品牌 · 测试店铺'), findsOneWidget);
    expect(find.text('¥399'), findsOneWidget);
    expect(find.text('¥299'), findsOneWidget);
    expect(find.text('优惠券 ¥20'), findsOneWidget);
    expect(find.text('根据通勤场景与简约风格推荐'), findsOneWidget);
    expect(find.text('匹配上衣、森林绿和合体版型'), findsOneWidget);
    expect(find.text('商品功能审核中'), findsOneWidget);

    final button = tester.widget<FilledButton>(
      find.byKey(const Key('buy-product-1')),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('product recommendation states support loading empty and retry', (
    tester,
  ) async {
    var retried = false;

    Widget card({bool loading = false, String? error}) {
      return MaterialApp(
        home: Scaffold(
          body: OutfitRecommendationCard(
            products: const [],
            selectedProductIds: const {},
            onProductTap: (_) {},
            onViewDetails: (_) {},
            favoriteProductIds: const {},
            onFavorite: (_) {},
            onTryOn: null,
            isLoading: loading,
            errorMessage: error,
            onRetry: () => retried = true,
          ),
        ),
      );
    }

    await tester.pumpWidget(card(loading: true));
    expect(
      find.byKey(const Key('product-recommendation-loading')),
      findsOneWidget,
    );

    await tester.pumpWidget(card());
    expect(
      find.byKey(const Key('product-recommendation-empty')),
      findsOneWidget,
    );

    await tester.pumpWidget(card(error: '商品匹配失败'));
    expect(
      find.byKey(const Key('product-recommendation-error')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('retry-product-recommendations')));
    expect(retried, isTrue);
  });

  testWidgets('failed product image displays a stable placeholder', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 390,
            child: ProductCard(
              product: product(imageUrl: 'assets/images/products/missing.jpg'),
              selected: false,
              compact: true,
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('图片暂时无法加载'), findsOneWidget);
  });

  testWidgets('non-empty products are not hidden by a stale error state', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: OutfitRecommendationCard(
              products: [product()],
              selectedProductIds: const {},
              onProductTap: (_) {},
              onViewDetails: (_) {},
              favoriteProductIds: const {},
              onFavorite: (_) {},
              onTryOn: null,
              errorMessage: '商品匹配失败',
            ),
          ),
        ),
      ),
    );

    expect(find.byKey(const Key('product-recommendation-error')), findsNothing);
    expect(find.text('结构感通勤上衣'), findsOneWidget);
  });

  testWidgets('complete recommendations render all five category sections', (
    tester,
  ) async {
    final products = [
      product(id: 'top', category: 'shirt'),
      product(id: 'bottom', category: 'trousers'),
      product(id: 'shoes', category: 'sneakers'),
      product(id: 'outerwear', category: 'jacket'),
      product(id: 'accessories', category: 'bag'),
    ];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: OutfitRecommendationCard(
              products: products,
              selectedProductIds: const {},
              onProductTap: (_) {},
              onViewDetails: (_) {},
              favoriteProductIds: const {},
              onFavorite: (_) {},
              onTryOn: null,
            ),
          ),
        ),
      ),
    );

    for (final title in const [
      '上衣推荐',
      '下装推荐',
      '鞋履推荐',
      '外套推荐',
      '配饰推荐',
    ]) {
      expect(find.text(title), findsOneWidget);
    }
    for (final slot in ProductCategory.values) {
      expect(find.byKey(Key('product-section-$slot')), findsOneWidget);
    }
  });
}
