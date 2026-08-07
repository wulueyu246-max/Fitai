import 'package:fit_ai/features/user/models/user_account.dart';
import 'package:fit_ai/features/user/pages/user_auth_page.dart';
import 'package:fit_ai/features/user/pages/user_profile_page.dart';
import 'package:fit_ai/features/user/repositories/local_auth_repository.dart';
import 'package:fit_ai/features/user/services/user_session_controller.dart';
import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:fit_ai/models/outfit_request.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/models/user_profile.dart';
import 'package:fit_ai/pages/ai_outfit_page.dart';
import 'package:fit_ai/services/brand_product_service.dart';
import 'package:fit_ai/services/product_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final account = UserAccount(
    id: 'budget-user',
    email: 'budget@example.com',
    displayName: 'Budget user',
    height: 168,
    weight: 52,
    gender: '女性',
    bodyType: '匀称体型',
    likedStyles: const ['极简'],
    budgetMin: 100,
    budgetMax: 1200,
    favoriteBrands: const ['COS'],
    createdAt: DateTime(2026),
  );

  testWidgets('account creation and profile pages contain no request budget',
      (tester) async {
    final controller = UserSessionController(repository: LocalAuthRepository());
    await tester.pumpWidget(
      MaterialApp(home: UserAuthPage(controller: controller)),
    );
    expect(find.text('单品预算'), findsNothing);
    expect(find.text('整套预算'), findsNothing);

    await tester.pumpWidget(
      MaterialApp(
        home: UserProfilePage(controller: controller, account: account),
      ),
    );
    expect(find.text('购物预算'), findsNothing);
    expect(find.byKey(const Key('item-budget-200-500')), findsNothing);
  });

  testWidgets('AI outfit page owns the per-request budget selectors',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: AiOutfitPage()),
    );
    await tester.pump();
    await tester.scrollUntilVisible(
      find.byKey(const Key('ai-request-budget')),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pump();

    expect(find.text('本次预算'), findsOneWidget);
    expect(find.text('仅用于本次 Look 与商品推荐，不会保存到个人资料。'), findsOneWidget);
    expect(find.byKey(const Key('ai-item-budget-<50')), findsOneWidget);
    expect(find.byKey(const Key('ai-item-budget-1000+')), findsOneWidget);
    expect(find.byKey(const Key('ai-outfit-budget-300以内')), findsOneWidget);
    expect(find.byKey(const Key('ai-outfit-budget-3000+')), findsOneWidget);

    await tester.tap(find.byKey(const Key('ai-item-budget-50-200')));
    await tester.tap(find.byKey(const Key('ai-outfit-budget-300-800')));
    await tester.pump();
    expect(
      tester
          .widget<ChoiceChip>(find.byKey(const Key('ai-item-budget-50-200')))
          .selected,
      isTrue,
    );
    expect(
      tester
          .widget<ChoiceChip>(find.byKey(const Key('ai-outfit-budget-300-800')))
          .selected,
      isTrue,
    );
  });

  testWidgets('request budget sits between body info and photo scanning',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: AiOutfitPage()),
    );
    await tester.pump();

    final sectionKeys = find
        .byWidgetPredicate(
          (widget) => widget.key == const Key('ai-body-info') ||
              widget.key == const Key('ai-request-budget') ||
              widget.key == const Key('ai-photo-scan'),
        )
        .evaluate()
        .map((element) => element.widget.key)
        .toList(growable: false);

    expect(
      sectionKeys,
      const [
        Key('ai-body-info'),
        Key('ai-request-budget'),
        Key('ai-photo-scan'),
      ],
    );
  });

  test('request budgets serialize without entering user profile models', () {
    const request = OutfitRequest(
      height: 168,
      weight: 52,
      scene: '约会',
      request: '法式穿搭',
      images: {'front': 'data:image/jpeg;base64,AA=='},
      itemBudget: '500-1000',
      outfitBudget: '1500-3000',
    );
    expect(request.toJson()['item_budget'], '500-1000');
    expect(request.toJson()['outfit_budget'], '1500-3000');
    expect(account.toJson().containsKey('itemBudget'), isFalse);
    expect(account.toJson().containsKey('outfitBudget'), isFalse);
    expect(
      UserProfileServiceDefaults.profile.toJson().containsKey('itemBudget'),
      isFalse,
    );
  });

  test('different request budgets reach product recommendation independently',
      () async {
    final source = _CapturingBrandProductService();
    final service = CatalogProductService(source: source);
    final analysis = _analysis();

    await service.recommendProducts(
      analysis: analysis,
      request: const OutfitRequest(
        height: 168,
        weight: 52,
        scene: '约会',
        request: '法式穿搭',
        gender: 'female',
        images: {'front': 'data:image/jpeg;base64,AA=='},
        itemBudget: '50-200',
        outfitBudget: '300-800',
      ),
    );
    await service.recommendProducts(
      analysis: analysis,
      request: const OutfitRequest(
        height: 168,
        weight: 52,
        scene: '约会',
        request: '法式穿搭',
        gender: 'female',
        images: {'front': 'data:image/jpeg;base64,AA=='},
        itemBudget: '500-1000',
        outfitBudget: '1500-3000',
      ),
    );

    expect(source.contexts, hasLength(2));
    expect(source.contexts[0]['budget'], 200);
    expect(source.contexts[0]['item_budget'], '50-200');
    expect(source.contexts[0]['outfit_budget'], '300-800');
    expect(source.contexts[1]['budget'], 1000);
    expect(source.contexts[1]['item_budget'], '500-1000');
    expect(source.contexts[1]['outfit_budget'], '1500-3000');
  });
}

OutfitAnalysis _analysis() => OutfitAnalysis.fromJson({
      'request_id': 'budget-request',
      'gender': 'female',
      'bodyProfile': '匀称体型',
      'style': '法式',
      'recommendations': {
        'top': '针织衫',
        'bottom': '阔腿裤',
        'shoes': '玛丽珍鞋',
        'accessories': '简约耳饰',
        'summary': '法式约会搭配',
      },
      'products': [
        {
          'category': 'top',
          'gender': 'female',
          'item_name': '短款针织衫',
          'search_keywords': ['女士 短款 针织衫'],
        },
      ],
    });

class UserProfileServiceDefaults {
  static const profile = UserProfile(
    height: 168,
    weight: 52,
    bodyType: '匀称体型',
    stylePreference: [],
    favoriteColors: [],
    favoriteBrands: [],
    purchaseHistory: [],
    tryOnHistory: [],
  );
}

class _CapturingBrandProductService implements BrandProductService {
  final contexts = <Map<String, dynamic>>[];

  @override
  Future<List<Product>> fetchProducts({
    String? brand,
    Map<String, dynamic>? recommendationContext,
  }) async {
    contexts.add(Map<String, dynamic>.from(recommendationContext ?? const {}));
    return const [];
  }

  @override
  Future<String> getCurrentPrice(String sku) async => '';

  @override
  Future<Product?> getProductBySku(String sku) async => null;

  @override
  Future<Uri?> getPurchaseUri(String sku) async => null;

  @override
  Future<int> getStock(String sku) async => 0;
}
