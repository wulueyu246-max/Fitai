import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/models/outfit_plan.dart';
import 'package:fit_ai/services/recommendation_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const service = RecommendationService();

  test('mock product database contains a commercial demo catalog', () {
    final products = MockProductDatabase.products;
    final brands = products.map((product) => product.brand).toSet();
    final categories = products.map((product) => product.wardrobeSlot).toSet();

    expect(products.length, greaterThanOrEqualTo(50));
    expect(
      brands,
      containsAll(['Uniqlo', 'Nike', 'Adidas', 'ZARA', 'COS', '优衣库']),
    );
    expect(
      categories,
      containsAll([
        ProductCategory.top,
        ProductCategory.bottom,
        ProductCategory.shoes,
        ProductCategory.outerwear,
        ProductCategory.accessories,
      ]),
    );
    expect(products.every((product) => product.aiReason.isNotEmpty), isTrue);
    expect(products.every((product) => product.style.isNotEmpty), isTrue);
    expect(products.every((product) => product.season.isNotEmpty), isTrue);
    expect(products.every((product) => product.fitType.isNotEmpty), isTrue);
  });

  test('recommendations use body proportion, style and scene', () {
    final products = service.recommendProducts(
      height: 173,
      weight: 55,
      bodyType: '偏瘦体型',
      shoulderRatio: '肩窄',
      legRatio: '腿长比例偏短',
      style: '商务极简',
      scene: '日常通勤',
      limit: 8,
    );

    expect(products, hasLength(8));
    expect(products.first.wardrobeSlot, ProductCategory.top);
    expect(products.first.aiReason, contains('针对肩部比例'));
    expect(
      products.map((product) => product.wardrobeSlot).toSet(),
      containsAll([
        ProductCategory.top,
        ProductCategory.bottom,
        ProductCategory.shoes,
        ProductCategory.outerwear,
      ]),
    );

    final plan = service.buildOutfitPlan(
      products: products,
      style: '极简',
      scene: '通勤',
      requestId: 'request-male-look',
      gender: 'male',
      createdTime: DateTime(2026, 7, 30),
    );
    expect(plan.products, hasLength(3));
    expect(plan.title, contains('通勤'));
    expect(plan.scene, '通勤');
    expect(plan.matchScore, inInclusiveRange(0, 100));
    final restored = OutfitPlan.fromJson(plan.toJson());
    expect(restored.matchScore, plan.matchScore);
    expect(restored.requestId, 'request-male-look');
    expect(restored.gender, 'male');
    expect(restored.style, '极简');
    expect(
      restored.matchesCurrentResult(
        requestId: 'request-male-look',
        gender: 'male',
      ),
      isTrue,
    );
    expect(
      restored.matchesCurrentResult(
        requestId: 'request-male-look',
        gender: 'female',
      ),
      isFalse,
    );
  });

  test('current AI Look never fills a missing slot from the Mock catalog', () {
    final products = MockProductDatabase.products
        .where(
          (product) =>
              product.wardrobeSlot == ProductCategory.top ||
              product.wardrobeSlot == ProductCategory.bottom,
        )
        .take(2)
        .toList(growable: false);

    expect(
      () => service.buildOutfitPlan(
        products: products,
        style: '极简',
        scene: '通勤',
        requestId: 'request-no-shoes',
        gender: 'male',
      ),
      throwsStateError,
    );
  });
}
