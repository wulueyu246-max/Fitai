import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/models/ai_recommendation_record.dart';
import 'package:fit_ai/services/favorite_service.dart';
import 'package:fit_ai/services/recommendation_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('favorite service toggles products and outfit plans locally', () async {
    final service = FavoriteService();
    final products = MockProductDatabase.products.take(12).toList();
    final product = products.first;
    final plan = const RecommendationService().buildOutfitPlan(
      products: products,
      style: '极简',
      scene: '通勤',
      createdTime: DateTime(2026, 7, 30),
    );

    expect(await service.toggleProduct(product), isTrue);
    expect(service.isProductFavorite(product.id), isTrue);
    expect(service.favoriteProducts.single.id, product.id);
    expect(await service.toggleProduct(product), isFalse);

    expect(await service.toggleOutfitPlan(plan), isTrue);
    expect(service.isOutfitPlanFavorite(plan.id), isTrue);
    expect(service.favoriteOutfitPlans.single.id, plan.id);
    expect(await service.toggleOutfitPlan(plan), isFalse);

    await service.addAIRecommendation(
      AIRecommendationRecord(
        id: 'ai-record-1',
        scene: '通勤',
        bodyAnalysis: '比例均衡',
        style: '极简',
        outfitPlan: plan,
        createdTime: DateTime(2026, 7, 30),
      ),
    );
    expect(service.aiRecommendationHistory.single.id, 'ai-record-1');
  });
}
