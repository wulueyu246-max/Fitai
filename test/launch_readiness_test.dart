import 'package:fit_ai/components/product_card.dart';
import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/features/user/pages/user_auth_page.dart';
import 'package:fit_ai/features/user/repositories/local_auth_repository.dart';
import 'package:fit_ai/features/user/services/user_session_controller.dart';
import 'package:fit_ai/models/fashion_profile.dart';
import 'package:fit_ai/models/outfit.dart';
import 'package:fit_ai/models/product_analytics.dart';
import 'package:fit_ai/models/user_profile.dart';
import 'package:fit_ai/pages/product_detail_page.dart';
import 'package:fit_ai/models/fitai_pro_plan.dart';
import 'package:fit_ai/services/fashion_profile_service.dart';
import 'package:fit_ai/services/fitai_pro_service.dart';
import 'package:fit_ai/services/virtual_try_on_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('local user repository supports registration, login and logout',
      () async {
    final repository = LocalAuthRepository();
    final registered = await repository.register(
      email: 'tester@fitai.local',
      password: 'fitai-test-123',
      displayName: '测试用户',
    );

    expect(registered.account.displayName, '测试用户');
    expect(registered.session.isMock, isTrue);
    expect(await repository.restoreSession(), isNotNull);

    await repository.logout();
    expect(await repository.restoreSession(), isNull);

    final loggedIn = await repository.login(
      email: 'tester@fitai.local',
      password: 'fitai-test-123',
    );
    expect(loggedIn.account.id, registered.account.id);
  });

  test('AI FashionProfile combines behavior, favorites and photo analysis',
      () async {
    final product = MockProductDatabase.products.first;
    final now = DateTime.now();
    final service = FashionProfileService();
    final generated = await service.generateAIProfile(
      base: const FashionProfile(
        likedStyles: ['极简'],
        likedBrands: [],
        budgetMin: 100,
        budgetMax: 1000,
        commonColors: ['黑色'],
        bodyFeatures: ['肩窄'],
        purchaseHistory: ['ORDER-1'],
      ),
      favoriteProducts: [product],
      productEvents: [
        ProductAnalyticsEvent(
          id: 'event-1',
          productId: product.id,
          action: ProductAnalyticsAction.tryOn,
          source: 'test',
          createdAt: now,
        ),
      ],
      photoAnalysisCount: 2,
    );

    expect(generated.personaLabels, isNotEmpty);
    expect(generated.evidence, hasLength(4));
    expect(generated.confidence, greaterThan(0.35));
    expect(generated.generatedAt, isNotNull);
  });

  test('Free and Pro entitlements have enforceable feature differences', () {
    const service = FitAIProService();
    final free = service.getEntitlements(
      const FitAIProMembership(active: false),
    );
    final pro = service.getEntitlements(
      const FitAIProMembership(active: true, planId: 'pro-monthly'),
    );

    expect(free.tier, FitAIMemberTier.free);
    expect(free.dailyAiLimit, 3);
    expect(free.canUse(FitAIProFeature.advancedTryOn), isFalse);
    expect(pro.tier, FitAIMemberTier.pro);
    expect(pro.canUse(FitAIProFeature.advancedTryOn), isTrue);
    expect(pro.dailyAiLimit, greaterThan(free.dailyAiLimit));
  });

  test('VirtualModel binds Avatar photos and products for a future API',
      () async {
    final products = MockProductDatabase.products.take(3).toList();
    final outfit = Outfit(
      height: 173,
      weight: 60,
      bodyType: '匀称',
      style: '极简',
      userImages: const {
        'front': 'data:image/jpeg;base64,front',
        'side': 'data:image/jpeg;base64,side',
        'back': 'data:image/jpeg;base64,back',
      },
      products: products,
    );
    final model = await const MockVirtualTryOnService(
      delay: Duration.zero,
    ).generateVirtualModel(outfit);

    expect(model.avatar, isNotNull);
    expect(model.avatar!.photoBindings, hasLength(3));
    expect(model.avatar!.primaryPhoto, contains('front'));
    expect(model.toJson()['outfit'], isA<Map<String, dynamic>>());
  });

  test('commercial Product and UserProfile preserve purchase and user data',
      () {
    final product = MockProductDatabase.products.first;
    const profile = UserProfile(
      height: 173,
      weight: 60,
      bodyType: '匀称',
      stylePreference: ['极简'],
      favoriteColors: ['黑色'],
      favoriteBrands: ['COS'],
      purchaseHistory: [],
      tryOnHistory: [],
      photos: {'front': 'data:image/jpeg;base64,front'},
      favoriteProductIds: ['product-1'],
    );
    final restored = UserProfile.fromJson(profile.toJson());

    expect(product.purchaseUrl, startsWith('https://'));
    expect(product.commission, greaterThan(0));
    expect(product.sku, isNotEmpty);
    expect(restored.photos['front'], contains('base64'));
    expect(restored.favoriteProductIds, contains('product-1'));
  });

  testWidgets('UserAuthPage exposes register and login flows', (tester) async {
    final controller = UserSessionController(
      repository: LocalAuthRepository(),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: UserAuthPage(controller: controller),
      ),
    );

    expect(find.text('登录'), findsWidgets);
    expect(find.text('注册'), findsOneWidget);
    expect(find.byKey(const Key('auth-email')), findsWidgets);
    expect(find.byKey(const Key('submit-login')), findsOneWidget);
  });

  testWidgets('ProductCard exposes buy, favorite, wardrobe and try-on actions',
      (tester) async {
    final product = MockProductDatabase.products.first;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 380,
              child: ProductCard(
                product: product,
                selected: false,
                onFavorite: () {},
                onAddToWardrobe: () {},
                onTryOn: () {},
                onBuy: () {},
                onViewDetails: () {},
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.byKey(Key('favorite-${product.id}')), findsOneWidget);
    expect(find.byKey(Key('wardrobe-${product.id}')), findsOneWidget);
    expect(find.byKey(Key('try-on-${product.id}')), findsOneWidget);
    expect(find.byKey(Key('buy-${product.id}')), findsOneWidget);
  });

  testWidgets('ProductDetailPage exposes commercial conversion actions',
      (tester) async {
    final product = MockProductDatabase.products.first;
    await tester.pumpWidget(
      MaterialApp(
        home: ProductDetailPage(product: product, trackOpen: false),
      ),
    );

    expect(find.text('商品详情'), findsOneWidget);
    expect(find.byKey(Key('detail-favorite-${product.id}')), findsOneWidget);
    expect(find.byKey(Key('detail-wardrobe-${product.id}')), findsOneWidget);
    expect(find.byKey(Key('detail-try-on-${product.id}')), findsNothing);
    expect(find.byKey(Key('detail-buy-${product.id}')), findsOneWidget);
  });
}
