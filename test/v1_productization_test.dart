import 'package:fit_ai/features/share/models/share_outfit.dart';
import 'package:fit_ai/features/share/widgets/share_outfit_card.dart';
import 'package:fit_ai/models/recommendation_feedback.dart';
import 'package:fit_ai/models/user_profile.dart';
import 'package:fit_ai/services/brand_product_service.dart';
import 'package:fit_ai/services/recommendation_engine.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const profile = UserProfile(
    height: 173,
    weight: 55,
    bodyType: '偏瘦、肩窄',
    stylePreference: ['极简', '通勤'],
    favoriteColors: ['黑色', '白色'],
    favoriteBrands: ['COS'],
    purchaseHistory: [],
    tryOnHistory: ['cos-clean-tee'],
  );

  test('UserProfile keeps recommendation and commerce history', () {
    final restored = UserProfile.fromJson(profile.toJson());

    expect(restored.height, 173);
    expect(restored.favoriteBrands, contains('COS'));
    expect(restored.tryOnHistory, contains('cos-clean-tee'));
  });

  test('RecommendationEngine returns products without a default Look pool', () {
    final result = const RecommendationEngine().generate(
      input: RecommendationEngineInput(
        userProfile: profile,
        aiBodyAnalysis: '肩部线条偏窄，腿长比例均衡',
        browsingRecords: ['commute-proportion'],
        favoriteProductIds: {'cos-clean-tee'},
        feedback: [
          RecommendationFeedback(
            id: 'feedback-1',
            userId: 'test-user',
            action: RecommendationFeedbackAction.tryOn,
            productId: 'cos-clean-tee',
            source: 'test',
            createdAt: DateTime(2026, 7, 30),
          ),
        ],
        scene: '通勤',
      ),
      postCatalog: const [],
      productLimit: 8,
    );

    expect(result.products, hasLength(8));
    expect(result.outfitPlan.products, hasLength(3));
    expect(result.homePosts, isEmpty);
    expect(result.personalizationSummary, contains('行为反馈'));
  });

  test('BrandProductService keeps real brand API boundary', () async {
    const service = MockBrandProductService();
    final cosProducts = await service.fetchProducts(brand: 'COS');

    expect(cosProducts, isNotEmpty);
    expect(cosProducts.every((product) => product.brand == 'COS'), isTrue);
    expect(
      await service.getProductBySku(cosProducts.first.sku),
      isNotNull,
    );
    expect(await service.getStock(cosProducts.first.sku), greaterThan(0));
  });

  testWidgets('ShareOutfitCard renders a complete shareable look', (
    tester,
  ) async {
    final result = const RecommendationEngine().generate(
      input: const RecommendationEngineInput(
        userProfile: profile,
        aiBodyAnalysis: '肩部线条偏窄',
        browsingRecords: [],
        favoriteProductIds: {},
        feedback: [],
        scene: '正式场合',
      ),
      postCatalog: const [],
    );
    final shareOutfit = ShareOutfit(
      id: 'share-test',
      userName: '测试用户',
      outfitPlan: result.outfitPlan,
      generatedAt: DateTime(2026, 7, 30),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 360,
              child: ShareOutfitCard(outfit: shareOutfit),
            ),
          ),
        ),
      ),
    );

    expect(find.text('树皮 Shupi'), findsOneWidget);
    expect(find.text(result.outfitPlan.title), findsOneWidget);
    expect(find.text('#树皮穿搭'), findsOneWidget);
  });
}
