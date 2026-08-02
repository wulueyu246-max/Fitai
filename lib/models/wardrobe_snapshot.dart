import 'ai_recommendation_record.dart';
import 'outfit_plan.dart';
import 'product.dart';
import 'try_on_record.dart';

class WardrobeSnapshot {
  const WardrobeSnapshot({
    required this.favoriteProducts,
    required this.outfitPlans,
    required this.tryOnHistory,
    required this.aiRecommendationHistory,
  });

  factory WardrobeSnapshot.empty() {
    return const WardrobeSnapshot(
      favoriteProducts: [],
      outfitPlans: [],
      tryOnHistory: [],
      aiRecommendationHistory: [],
    );
  }

  factory WardrobeSnapshot.fromJson(Map<String, dynamic> json) {
    List<Map<String, dynamic>> objects(String key) {
      return (json[key] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList(growable: false);
    }

    return WardrobeSnapshot(
      favoriteProducts:
          objects('favoriteProducts').map(Product.fromJson).toList(),
      outfitPlans: objects('outfitPlans').map(OutfitPlan.fromJson).toList(),
      tryOnHistory: objects('tryOnHistory').map(TryOnRecord.fromJson).toList(),
      aiRecommendationHistory: objects('aiRecommendationHistory')
          .map(AIRecommendationRecord.fromJson)
          .toList(),
    );
  }

  final List<Product> favoriteProducts;
  final List<OutfitPlan> outfitPlans;
  final List<TryOnRecord> tryOnHistory;
  final List<AIRecommendationRecord> aiRecommendationHistory;

  bool get isEmpty =>
      favoriteProducts.isEmpty &&
      outfitPlans.isEmpty &&
      tryOnHistory.isEmpty &&
      aiRecommendationHistory.isEmpty;

  Map<String, dynamic> toJson() => {
        'favoriteProducts':
            favoriteProducts.map((item) => item.toJson()).toList(),
        'outfitPlans': outfitPlans.map((item) => item.toJson()).toList(),
        'tryOnHistory': tryOnHistory.map((item) => item.toJson()).toList(),
        'aiRecommendationHistory':
            aiRecommendationHistory.map((item) => item.toJson()).toList(),
      };
}
