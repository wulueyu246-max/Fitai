import 'package:fit_ai/core/logging/app_logger.dart';
import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/features/user/repositories/local_auth_repository.dart';
import 'package:fit_ai/features/user/services/user_session_controller.dart';
import 'package:fit_ai/models/conversion_event.dart';
import 'package:fit_ai/models/outfit.dart';
import 'package:fit_ai/models/outfit_plan.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/models/try_on_request.dart';
import 'package:fit_ai/models/user_profile.dart';
import 'package:fit_ai/models/virtual_try_on_task.dart';
import 'package:fit_ai/pages/product_detail_page.dart';
import 'package:fit_ai/pages/privacy_center_page.dart';
import 'package:fit_ai/repositories/user_profile_repository.dart';
import 'package:fit_ai/services/affiliate_service.dart';
import 'package:fit_ai/services/analytics_service.dart';
import 'package:fit_ai/services/consent_service.dart';
import 'package:fit_ai/services/digital_wardrobe_service.dart';
import 'package:fit_ai/services/product_analytics_service.dart';
import 'package:fit_ai/services/purchase_launcher.dart';
import 'package:fit_ai/services/user_data_deletion_service.dart';
import 'package:fit_ai/services/user_profile_service.dart';
import 'package:fit_ai/services/virtual_try_on_service.dart';
import 'package:fit_ai/services/wardrobe_recognition_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Product uses canonical commissionRate and purchaseUrl fields', () {
    final product = MockProductDatabase.products.first;
    final restored = Product.fromJson(product.toJson());

    expect(product.purchaseUrl, isNotEmpty);
    expect(product.commissionRate, greaterThan(0));
    expect(product.commission, product.commissionRate);
    expect(product.image, product.imageUrl);
    expect(product.toJson()['image'], product.imageUrl);
    expect(product.toJson()['commission'], product.commissionRate);
    expect(restored.purchaseUrl, product.purchaseUrl);
    expect(restored.commissionRate, product.commissionRate);
  });

  test('Consent is versioned, explicit and revocable', () async {
    final service = ConsentService();
    expect((await service.load()).hasRequiredConsent, isFalse);

    final granted = await service.grantRequiredConsent();
    expect(granted.hasRequiredConsent, isTrue);

    final revoked = await service.revokePhotoProcessing();
    expect(revoked.photoProcessingAllowed, isFalse);
    expect(revoked.hasRequiredConsent, isFalse);
  });

  test('UserProfile persists age and supports a replaceable repository',
      () async {
    final repository = _MemoryUserProfileRepository();
    final service = UserProfileService(repository: repository);
    const profile = UserProfile(
      height: 168,
      weight: 52,
      age: 29,
      bodyType: '匀称',
      stylePreference: ['极简'],
      favoriteColors: ['黑色'],
      favoriteBrands: ['COS'],
      purchaseHistory: [],
      tryOnHistory: [],
      photos: {'front': 'mock-front-image'},
      favoriteProductIds: ['product-1'],
      outfitHistory: ['look-1'],
      avatarBase64: 'mock-avatar',
    );

    await service.save(profile);
    final restored = await service.load();

    expect(restored.age, 29);
    expect(restored.photos['front'], 'mock-front-image');
    expect(restored.favoriteProductIds, ['product-1']);
    expect(restored.outfitHistory, ['look-1']);
    expect(repository.savedProfiles, hasLength(1));
  });

  test('AffiliateService emits click and purchase conversion events', () async {
    final launcher = _RecordingPurchaseLauncher();
    final analytics = ProductAnalyticsService(
      analyticsService: LocalAnalyticsService(),
    );
    final affiliate = LocalAffiliateService(
      analytics: analytics,
      purchaseLauncher: launcher,
    );
    final product = MockProductDatabase.products.first;

    final click = await affiliate.recordProductClick(
      product: product,
      source: 'affiliate-test',
      userId: 'user-1',
    );
    final purchase = await affiliate.openPurchase(
      product: product,
      source: 'affiliate-test',
      userId: 'user-1',
    );

    expect(click.action, ProductAnalyticsAction.click);
    expect(purchase.action, ProductAnalyticsAction.purchaseRedirect);
    expect(purchase.sku, product.sku);
    expect(purchase.commission, product.commission);
    expect(purchase.attributionId, isNotEmpty);
    expect(launcher.openedProductIds, [product.id]);
    expect(
      Uri.parse(launcher.openedPurchaseUrls.single)
          .queryParameters['fitai_click_id'],
      purchase.attributionId,
    );
  });

  test('photo deletion clears profile, avatar, wardrobe and consent', () async {
    final profileService = UserProfileService();
    const profile = UserProfile(
      height: 173,
      weight: 60,
      bodyType: '匀称',
      stylePreference: ['极简'],
      favoriteColors: [],
      favoriteBrands: [],
      purchaseHistory: [],
      tryOnHistory: [],
      photos: {'front': 'data:image/jpeg;base64,front'},
      avatarBase64: 'YXZhdGFy',
    );
    await profileService.save(profile);

    final session = UserSessionController(repository: LocalAuthRepository());
    await session.register(
      email: 'delete@fitai.local',
      password: 'fitai-delete-123',
      displayName: 'Delete Test',
    );
    await session.updateProfile(
      session.account!.copyWith(avatarBase64: 'YXZhdGFy'),
    );

    final wardrobe = DigitalWardrobeService(
      recognitionService:
          const MockWardrobeRecognitionService(delay: Duration.zero),
    );
    await wardrobe.addUploadedClothing(
      imageBytes: List<int>.generate(32, (index) => index),
      fileName: 'shirt.jpg',
    );
    final consent = ConsentService();
    await consent.grantRequiredConsent();

    final deletion = UserDataDeletionService(
      profileService: profileService,
      wardrobeService: wardrobe,
      sessionController: session,
      consentService: consent,
    );
    final report = await deletion.deleteAllLocalPhotos();

    expect(report.totalLocalRecordsRemoved, greaterThanOrEqualTo(3));
    expect((await profileService.load()).photos, isEmpty);
    expect(session.account!.avatarBase64, isNull);
    expect(await wardrobe.load(), isEmpty);
    expect((await consent.load()).photoProcessingAllowed, isFalse);
  });

  test('AppLogger redacts photos, tokens and long image payloads', () {
    final logger = AppLogger.instance;
    logger.clear();
    logger.info(
      'privacy-test',
      metadata: {
        'token': 'secret-token',
        'frontImage': 'data:image/jpeg;base64,secret',
        'productId': 'product-1',
      },
    );

    final metadata = logger.entries.first.metadata;
    expect(metadata['token'], '[REDACTED]');
    expect(metadata['frontImage'], '[REDACTED]');
    expect(metadata['productId'], 'product-1');
  });

  test('VirtualTryOnService supports createTask, getStatus and getResult',
      () async {
    final products = MockProductDatabase.products;
    Product slot(String category) => products.firstWhere(
          (product) => product.wardrobeSlot == category,
        );
    final now = DateTime.now();
    final plan = OutfitPlan(
      id: 'plan-commercial-test',
      title: '商业试穿',
      top: slot(ProductCategory.top),
      bottom: slot(ProductCategory.bottom),
      shoes: slot(ProductCategory.shoes),
      reason: '比例匹配',
      createdTime: now,
    );
    final outfit = Outfit(
      userId: 'user-commercial-test',
      height: 173,
      weight: 60,
      bodyType: '匀称',
      style: '极简',
      userImages: const {'front': 'data:image/jpeg;base64,front'},
      products: plan.products,
    );
    const service = MockVirtualTryOnService(
      delay: Duration.zero,
      generationDelay: Duration.zero,
    );
    final model = await service.generateVirtualModel(outfit);
    final request = TryOnRequest(
      userId: outfit.userId,
      virtualModel: model,
      products: plan.products,
      outfitPlan: plan,
      userProfile: UserProfileService.defaultProfile,
      userImage: outfit.userImages['front']!,
      createdTime: now,
    );

    final task = await service.createTask(request);
    final status = await service.getStatus(task.id);
    final result = await service.getResult(task.id);

    expect(task.status, VirtualTryOnTaskStatus.waiting);
    expect(request.outfitPlan.look, '商业试穿');
    expect(request.outfitPlan.toJson()['products'], hasLength(3));
    expect(request.toJson()['userProfile'], isA<Map<String, dynamic>>());
    expect(status.status, VirtualTryOnTaskStatus.success);
    expect(status.progress, 1);
    expect(result.image, isNotEmpty);
  });

  testWidgets('successful external purchase launch records conversion callback',
      (tester) async {
    final product = MockProductDatabase.products.first;
    final launcher = _RecordingPurchaseLauncher();
    var purchaseCallbacks = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: ProductDetailPage(
          product: product,
          trackOpen: false,
          purchaseLauncher: launcher,
          onPurchase: (_) async => purchaseCallbacks += 1,
        ),
      ),
    );

    final buyButton = find.byKey(Key('detail-buy-${product.id}'));
    await tester.ensureVisible(buyButton);
    await tester.pumpAndSettle();
    await tester.tap(buyButton);
    await tester.pumpAndSettle();

    expect(launcher.openedProductIds, [product.id]);
    expect(purchaseCallbacks, 1);
    expect(find.text('已打开品牌购买页面'), findsOneWidget);
  });

  testWidgets('PrivacyCenter exposes consent and photo deletion controls',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PrivacyCenterPage(consentService: ConsentService()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('隐私与数据中心'), findsOneWidget);
    expect(find.byKey(const Key('open-legal-consent')), findsOneWidget);
    expect(find.byKey(const Key('delete-all-user-photos')), findsOneWidget);
  });
}

class _RecordingPurchaseLauncher implements PurchaseLauncher {
  final List<String> openedProductIds = [];
  final List<String> openedPurchaseUrls = [];

  @override
  Future<void> open(Product product) async {
    openedProductIds.add(product.id);
    openedPurchaseUrls.add(product.purchaseUrl);
  }
}

class _MemoryUserProfileRepository implements UserProfileRepository {
  final List<UserProfile> savedProfiles = [];
  UserProfile? _profile;

  @override
  Future<UserProfile?> load() async => _profile;

  @override
  Future<void> save(UserProfile profile) async {
    _profile = profile;
    savedProfiles.add(profile);
  }
}
