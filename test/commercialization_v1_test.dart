import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/features/commerce/models/product_event.dart';
import 'package:fit_ai/features/commerce/models/product_commerce.dart';
import 'package:fit_ai/features/commerce/repositories/mock_product_commerce_repository.dart';
import 'package:fit_ai/features/commerce/services/product_event_service.dart';
import 'package:fit_ai/models/brand_partner.dart';
import 'package:fit_ai/models/fashion_profile.dart';
import 'package:fit_ai/models/product_analytics.dart';
import 'package:fit_ai/models/user_profile.dart';
import 'package:fit_ai/pages/digital_wardrobe_page.dart';
import 'package:fit_ai/services/analytics_service.dart';
import 'package:fit_ai/services/brand_partner_service.dart';
import 'package:fit_ai/services/digital_wardrobe_service.dart';
import 'package:fit_ai/services/product_analytics_service.dart';
import 'package:fit_ai/services/user_fashion_profile_service.dart';
import 'package:fit_ai/services/wardrobe_recognition_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('ProductCommerce exposes mock price, stock and purchase boundary',
      () async {
    const repository = MockProductCommerceRepository();
    final product = MockProductDatabase.products.first;
    final commerce = await repository.getCommerce(product.sku);

    expect(commerce, isNotNull);
    expect(commerce!.currentPrice, product.price);
    expect(commerce.stockStatus, ProductStockStatus.inStock);
    expect(commerce.purchaseUri, isNotNull);
    expect(product.effectiveStyleTags, isNotEmpty);
  });

  test('ProductEvent produces a six-stage conversion funnel', () async {
    final analytics = LocalAnalyticsService();
    final events = ProductEventService(
      analytics: ProductAnalyticsService(analyticsService: analytics),
    );
    final product = MockProductDatabase.products.first;

    for (final type in ProductEventType.values) {
      await events.record(
        type: type,
        product: product,
        source: 'commerce-test',
        orderId:
            type == ProductEventType.purchaseCompleted ? 'mock-order-1' : null,
      );
    }
    final funnel = await events.getFunnel(productId: product.id);
    final dashboard = await analytics.getDashboard();

    expect(funnel.impressions, 1);
    expect(funnel.clicks, 1);
    expect(funnel.favorites, 1);
    expect(funnel.addedToTryOn, 1);
    expect(funnel.purchaseRedirects, 1);
    expect(funnel.purchasesCompleted, 1);
    expect(funnel.endToEndConversionRate, 1);
    expect(dashboard.popularProductIds, contains(product.id));
  });

  test('UserFashionProfile combines body, budget and click history', () async {
    const user = UserProfile(
      height: 173,
      weight: 55,
      bodyType: '偏瘦',
      stylePreference: ['极简'],
      favoriteColors: ['黑色'],
      favoriteBrands: ['COS'],
      purchaseHistory: [],
      tryOnHistory: [],
    );
    const fashion = FashionProfile(
      likedStyles: ['通勤'],
      likedBrands: ['Uniqlo'],
      budgetMin: 200,
      budgetMax: 900,
      commonColors: ['白色'],
      bodyFeatures: ['肩窄'],
      purchaseHistory: [],
    );
    final service = UserFashionProfileService();
    final profile = await service.loadOrCreate(user: user, fashion: fashion);
    final updated = await service.recordClick(profile, 'product-1');

    expect(updated.height, 173);
    expect(updated.favoriteBrands, containsAll(['COS', 'Uniqlo']));
    expect(updated.sceneNeeds, contains('通勤'));
    expect(updated.clickHistory.first, 'product-1');
  });

  test('BrandPartner exposes mock commission and cooperation contracts',
      () async {
    const service = MockBrandPartnerService();
    final uniqlo = await service.getByBrandId('uniqlo');

    expect(uniqlo, isNotNull);
    expect(uniqlo!.supportsCommission, isTrue);
    expect(uniqlo.status, BrandPartnerStatus.mockConnected);
    await service.submitCooperationIntent(
      brandId: uniqlo.brandId,
      contact: 'demo@fitai.local',
    );
  });

  test('DigitalWardrobe recognizes clothing and creates an auto look',
      () async {
    final service = DigitalWardrobeService(
      recognitionService:
          const MockWardrobeRecognitionService(delay: Duration.zero),
    );
    final item = await service.addUploadedClothing(
      imageBytes: List<int>.generate(32, (index) => index),
      fileName: 'shirt.jpg',
    );
    final look = await service.autoMatch();

    expect(item.category, isNotEmpty);
    expect(look, isNotNull);
    expect(look!.items, contains(item));
    expect(look.aiReason, contains('Mock'));
  });

  test('Analytics measures dwell, try-on rate and popular products', () async {
    final analytics = LocalAnalyticsService();
    final productAnalytics = ProductAnalyticsService(
      analyticsService: analytics,
    );
    final product = MockProductDatabase.products.first;
    await productAnalytics.record(
      action: ProductAnalyticsAction.impression,
      product: product,
      source: 'analytics-test',
    );
    await productAnalytics.record(
      action: ProductAnalyticsAction.click,
      product: product,
      source: 'analytics-test',
    );
    await productAnalytics.record(
      action: ProductAnalyticsAction.tryOn,
      product: product,
      source: 'analytics-test',
    );
    await analytics.track('new_user_onboarding_completed', userId: 'new-user');
    await analytics.track('photo_upload_completed', userId: 'new-user');
    await analytics.track('outfit_generated', userId: 'new-user');
    await analytics.trackPageDwell('home', const Duration(seconds: 12));

    final dashboard = await analytics.getDashboard();
    expect(dashboard.tryOnRate, 1);
    expect(dashboard.averageDwellSeconds, 12);
    expect(dashboard.popularProductIds.first, product.id);
    expect(dashboard.dailyNewUsers, greaterThanOrEqualTo(1));
    expect(dashboard.dailyPhotoUploadUsers, greaterThanOrEqualTo(1));
    expect(dashboard.dailyOutfitGenerationCount, greaterThanOrEqualTo(1));
    expect(dashboard.dailyProductClicks, greaterThanOrEqualTo(1));
  });

  testWidgets('DigitalWardrobePage renders upload and auto-match actions',
      (tester) async {
    final service = DigitalWardrobeService(
      recognitionService:
          const MockWardrobeRecognitionService(delay: Duration.zero),
    );
    await tester.pumpWidget(
      MaterialApp(home: DigitalWardrobePage(service: service)),
    );
    await tester.pumpAndSettle();

    expect(find.text('我的数字衣橱'), findsOneWidget);
    expect(find.byKey(const Key('upload-wardrobe-item')), findsOneWidget);
    expect(find.byKey(const Key('auto-match-wardrobe')), findsOneWidget);
    expect(find.text('衣橱还是空的'), findsOneWidget);
  });
}
