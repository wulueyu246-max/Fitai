import 'package:fit_ai/components/outfit_recommendation_card.dart';
import 'package:fit_ai/components/product_card.dart';
import 'package:fit_ai/components/product_image.dart';
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
    String? sales,
    double finalScore = 0,
    String aiLabel = '',
    String aiConcern = '',
    String aiRecommendationReason = '',
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
      sales: sales,
      recommendationReason: '根据通勤场景与简约风格推荐',
      matchExplanation: '匹配上衣、森林绿和合体版型',
      finalScore: finalScore,
      aiTasteScore: finalScore,
      fitScore: finalScore,
      outfitCoherenceScore: finalScore,
      valueScore: finalScore,
      aiLabel: aiLabel,
      aiConcern: aiConcern,
      aiRecommendationReason: aiRecommendationReason,
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

  test('normalizes protocol-relative public product image URLs', () {
    final parsed = Product.fromJson({
      'product_id': 'taobao-image-1',
      'title': '真实商品',
      'category': 'top',
      'image_url': '//img.alicdn.com/bao/uploaded/item.jpg',
      'price': 99,
      'source': 'taobao',
      'is_mock': false,
    });

    expect(
      parsed.imageUrl,
      'https://img.alicdn.com/bao/uploaded/item.jpg',
    );
    expect(parsed.isNetworkImage, isTrue);
  });

  test('Flutter display policy blocks low-value Look products', () {
    final underwear = product().copyWith(name: 'Tom Ford 男士内裤');
    final shirt = product().copyWith(name: '男士短袖Polo');

    expect(underwear.isAllowedForLookRecommendation, isFalse);
    expect(lookProductQualityBlock(underwear)?.blockedKeyword, '内裤');
    expect(shirt.isAllowedForLookRecommendation, isTrue);
    expect(
      lookProductQualityBlock(
        underwear,
        explicitSearchKeyword: '男士内裤',
      ),
      isNull,
    );
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

  test('parses AI aesthetic scores, reason, concern and label', () {
    final parsed = Product.fromJson({
      'product_id': 'taobao-ai-1',
      'title': '男士浅灰色短袖Polo',
      'category': 'top',
      'image_url': 'https://img.example.com/polo.jpg',
      'price': 199,
      'purchase_url': 'https://s.click.taobao.com/polo',
      'source': 'taobao',
      'is_mock': false,
      'relevance_score': 88,
      'ai_taste_score': 94,
      'fit_score': 91,
      'outfit_coherence_score': 95,
      'value_score': 86,
      'final_score': 92.4,
      'ai_recommendation_reason': '版型简洁，与整套穿搭协调。',
      'ai_concern': '面料信息不完整。',
      'ai_label': 'AI首选',
      'ai_rerank_fallback': false,
    });

    expect(parsed.relevanceScore, 88);
    expect(parsed.aiTasteScore, 94);
    expect(parsed.finalScore, 92.4);
    expect(parsed.aiRecommendationReason, '版型简洁，与整套穿搭协调。');
    expect(parsed.aiConcern, '面料信息不完整。');
    expect(parsed.aiLabel, 'AI首选');
    expect(parsed.hasAiTasteSelection, isTrue);
  });

  testWidgets('product card displays AI match, label, reason and concern', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 390,
              child: ProductCard(
                product: product(
                  finalScore: 92.4,
                  aiLabel: 'AI首选',
                  aiConcern: '购买前建议查看面料详情。',
                  aiRecommendationReason: '版型简洁，与米白色下装协调。',
                ),
                selected: false,
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text('AI首选'), findsOneWidget);
    expect(find.text('AI匹配度 92%'), findsOneWidget);
    expect(find.text('版型简洁，与米白色下装协调。'), findsOneWidget);
    expect(find.text('注意：购买前建议查看面料详情。'), findsOneWidget);
  });

  testWidgets('long AI copy never overflows and product actions stay visible', (
    tester,
  ) async {
    final longText = List.filled(
      30,
      '这是一段用于验证商品卡布局稳定性的超长AI推荐文案',
    ).join('，');
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 268,
            height: 820,
            child: ProductCard(
              product: product().copyWith(
                name: longText,
                recommendationReason: longText,
                aiRecommendationReason: longText,
                matchExplanation: longText,
                description: longText,
                aiReason: longText,
                finalScore: 90,
              ),
              selected: false,
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('details-product-1')), findsOneWidget);
    expect(find.byKey(const Key('buy-product-1')), findsOneWidget);
    final reason = tester.widget<Text>(
      find.byKey(const Key('recommendation-reason-product-1')),
    );
    final explanation = tester.widget<Text>(
      find.byKey(const Key('match-explanation-product-1')),
    );
    expect(reason.maxLines, 3);
    expect(reason.overflow, TextOverflow.ellipsis);
    expect(explanation.maxLines, 1);
    expect(explanation.overflow, TextOverflow.ellipsis);
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

  testWidgets('real product without promotion URL is clearly disabled', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 390,
              child: ProductCard(
                product: product(purchaseUrl: ''),
                selected: false,
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text('推广链接暂未开通'), findsOneWidget);
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('buy-product-1')),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('real product displays sales only when supplied', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 390,
              child: ProductCard(
                product: product(sales: '268'),
                selected: false,
              ),
            ),
          ),
        ),
      ),
    );
    expect(find.text('销量 268'), findsOneWidget);
    expect(find.text('立即购买'), findsOneWidget);
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

  testWidgets('empty product image displays the formal placeholder', (
    tester,
  ) async {
    final emptyImageProduct = product(imageUrl: '');
    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(
          width: 160,
          height: 180,
          child: ProductImage(product: emptyImageProduct),
        ),
      ),
    );

    expect(
      find.byKey(const Key('product-image-placeholder-product-1')),
      findsOneWidget,
    );
    expect(find.text('图片暂时无法加载'), findsOneWidget);
  });

  testWidgets('404 product image falls back without an ErrorWidget', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(
          width: 160,
          height: 180,
          child: ProductImage(
            product: product(
              id: '404-image',
              imageUrl: 'https://example.invalid/not-found.jpg',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(ErrorWidget), findsNothing);
    expect(
      find.byKey(const Key('product-image-placeholder-404-image')),
      findsOneWidget,
    );
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
