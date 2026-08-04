import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/features/home/models/daily_fashion_context.dart';
import 'package:fit_ai/models/fashion_profile.dart';
import 'package:fit_ai/models/outfit_plan.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/models/product_analytics.dart';
import 'package:fit_ai/pages/brand_page.dart';
import 'package:fit_ai/pages/fitai_pro_page.dart';
import 'package:fit_ai/services/analytics_service.dart';
import 'package:fit_ai/services/brand_service.dart';
import 'package:fit_ai/services/community_engagement_service.dart';
import 'package:fit_ai/services/daily_outfit_service.dart';
import 'package:fit_ai/services/product_analytics_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('FashionProfile persists budget and purchase preferences', () {
    const profile = FashionProfile(
      likedStyles: ['通勤', '极简'],
      likedBrands: ['COS'],
      budgetMin: 200,
      budgetMax: 800,
      commonColors: ['黑色', '白色'],
      bodyFeatures: ['肩窄'],
      purchaseHistory: ['FITAI-001'],
    );
    final restored = FashionProfile.fromJson(profile.toJson());

    expect(restored.likedBrands, contains('COS'));
    expect(restored.isWithinBudget('599'), isTrue);
    expect(restored.isWithinBudget('1299'), isFalse);
  });

  test('ProductAnalytics builds a complete conversion funnel', () async {
    final analytics = LocalAnalyticsService();
    final service = ProductAnalyticsService(
      analyticsService: analytics,
    );
    final product = MockProductDatabase.products.first;

    for (final action in ProductAnalyticsAction.values) {
      await service.record(
        action: action,
        product: product,
        source: 'test',
      );
    }

    final snapshot = await service.getSnapshot(productId: product.id);
    final dashboard = await analytics.getDashboard();

    expect(snapshot.funnel.impressions, 1);
    expect(snapshot.funnel.clicks, 1);
    expect(snapshot.funnel.favorites, 1);
    expect(snapshot.funnel.tryOns, 1);
    expect(snapshot.funnel.purchaseRedirects, 1);
    expect(dashboard.recommendationClickRate, 1);
    expect(dashboard.productConversionRate, 1);
    expect(dashboard.tryOnCount, 1);
  });

  test('DailyOutfitService creates a stable daily commercial look', () {
    final products = MockProductDatabase.products;
    Product slot(String category) =>
        products.firstWhere((product) => product.wardrobeSlot == category);
    final generatedAt = DateTime(2026, 7, 30, 9);
    final outfit = const LocalDailyOutfitService().generate(
      context: DailyFashionContext(
        temperature: 18,
        condition: '小雨',
        city: '北京',
        updatedAt: generatedAt,
      ),
      scene: '商务会议',
      plan: OutfitPlan(
        id: 'daily-test',
        title: '北京商务会议Look',
        top: slot(ProductCategory.top),
        bottom: slot(ProductCategory.bottom),
        shoes: slot(ProductCategory.shoes),
        reason: '比例与天气匹配',
        createdTime: generatedAt,
      ),
      aiReason: '18℃小雨，建议增加外套层次',
    );

    expect(outfit.id, 'daily-2026-7-30-商务会议');
    expect(outfit.context.city, '北京');
    expect(outfit.plan.products, hasLength(3));
  });

  test('community engagement supports like, save, comment and follow',
      () async {
    final service = CommunityEngagementService();

    await service.toggleLike('post-1');
    await service.toggleSave('post-1');
    await service.addComment('post-1');
    final state = await service.toggleFollow('FitAI造型师');

    expect(state.likedPostIds, contains('post-1'));
    expect(state.savedPostIds, contains('post-1'));
    expect(state.commentCounts['post-1'], 1);
    expect(state.followedAuthors, contains('FitAI造型师'));
  });

  testWidgets('BrandPage exposes brand story, products and AI zone', (
    tester,
  ) async {
    final brand = (await const MockBrandService(
      delay: Duration.zero,
    ).getBrands())
        .first;

    await tester.pumpWidget(
      MaterialApp(
        home: BrandPage(
          brand: brand,
          brandService: const MockBrandService(delay: Duration.zero),
          onTryOn: (_) {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(brand.name), findsWidgets);
    expect(find.text('AI推荐专区'), findsOneWidget);
    expect(find.text('Mock合作商品库'), findsOneWidget);
  });

  testWidgets('FitAI Pro renders plans without enabling real payment', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: FitAIProPage()),
    );

    expect(find.text('FitAI Pro'), findsOneWidget);
    expect(find.text('FitAI Pro 月度'), findsOneWidget);
    expect(find.text('FitAI Pro 年度'), findsOneWidget);
    await tester.fling(
      find.byType(ListView),
      const Offset(0, -1200),
      3000,
    );
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('不包含真实支付'), findsOneWidget);
  });
}
