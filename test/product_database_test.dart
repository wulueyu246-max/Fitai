import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/pages/product_management_page.dart';
import 'package:fit_ai/repositories/mock_product_repository.dart';
import 'package:fit_ai/services/recommendation_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('bundled Product table contains at least 50 complete records', () {
    final products = MockProductDatabase.products;

    expect(products.length, greaterThanOrEqualTo(50));
    for (final product in products) {
      final json = product.toJson();
      expect(json['id'], isNotEmpty);
      expect(json['brand'], isNotEmpty);
      expect(json['name'], isNotEmpty);
      expect(json['category'], isNotEmpty);
      expect(json['imageUrl'], isNotEmpty);
      expect(json['price'], isNotEmpty);
      expect(json['color'], isNotEmpty);
      expect(json['size'], isNotEmpty);
      expect(json['material'], isNotEmpty);
      expect(json['season'], isNotEmpty);
      expect(json['style'], isNotEmpty);
      expect(json['purchaseUrl'], isNotEmpty);
      expect(json['isAvailable'], isA<bool>());
    }
  });

  test('repository hides unavailable products from the customer catalog',
      () async {
    final first = MockProductDatabase.products.first;
    final second = MockProductDatabase.products[1];
    final repository = MockProductRepository(seeds: [first, second]);

    await repository.setAvailability(first.id, false);

    expect(await repository.listProducts(), [second]);
    expect(
      await repository.listProducts(includeUnavailable: true),
      hasLength(2),
    );
    expect((await repository.getById(first.id))?.isAvailable, isFalse);
  });

  test('recommendation never falls back when the database catalog is empty',
      () {
    final result = const RecommendationService().recommendProducts(
      height: 173,
      weight: 60,
      bodyType: '匀称',
      shoulderRatio: '正常',
      legRatio: '正常',
      style: '极简',
      scene: '通勤',
      catalog: const [],
    );

    expect(result, isEmpty);
  });

  test('recommendation excludes unavailable database records', () {
    final unavailable =
        MockProductDatabase.products.first.copyWith(isAvailable: false);
    final available = MockProductDatabase.products[1];

    final result = const RecommendationService().recommendProducts(
      height: 173,
      weight: 60,
      bodyType: '匀称',
      shoulderRatio: '正常',
      legRatio: '正常',
      style: '极简',
      scene: '通勤',
      catalog: [unavailable, available],
    );

    expect(result.map((item) => item.id), isNot(contains(unavailable.id)));
    expect(result.map((item) => item.id), contains(available.id));
  });

  testWidgets('management page searches and changes product availability',
      (tester) async {
    final first = MockProductDatabase.products.first;
    final second = MockProductDatabase.products[1];
    final repository = MockProductRepository(seeds: [first, second]);

    await tester.pumpWidget(
      MaterialApp(
        home: ProductManagementPage(repository: repository),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('product-management-page')), findsOneWidget);
    expect(find.textContaining('共 2 件'), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('product-database-search')),
      first.id,
    );
    await tester.pump();
    expect(find.text(first.name), findsOneWidget);
    expect(find.text(second.name), findsNothing);

    await tester.tap(find.byKey(Key('availability-${first.id}')));
    await tester.pumpAndSettle();
    expect((await repository.getById(first.id))?.isAvailable, isFalse);
    expect(find.text('已下架'), findsOneWidget);
  });
}
