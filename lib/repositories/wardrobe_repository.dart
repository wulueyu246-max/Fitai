import 'package:flutter/foundation.dart';

import '../data/mock_product_database.dart';
import '../models/ai_recommendation_record.dart';
import '../models/outfit_plan.dart';
import '../models/product.dart';
import '../models/try_on_record.dart';
import '../models/wardrobe_snapshot.dart';
import '../services/favorite_service.dart';

abstract interface class WardrobeRepository {
  Listenable get changes;

  Future<WardrobeSnapshot> load();

  Future<bool> toggleProduct(Product product);

  Future<bool> toggleOutfitPlan(OutfitPlan plan);

  Future<void> saveTryOnRecord(TryOnRecord record);

  Future<void> saveAIRecommendation(AIRecommendationRecord record);
}

class LocalWardrobeRepository implements WardrobeRepository {
  LocalWardrobeRepository({FavoriteService? favoriteService})
      : _favoriteService = favoriteService ?? FavoriteService.instance;

  final FavoriteService _favoriteService;

  @override
  Listenable get changes => _favoriteService;

  @override
  Future<WardrobeSnapshot> load() async {
    await _favoriteService.ensureLoaded();
    final savedProducts = {
      for (final product in _favoriteService.favoriteProducts)
        product.id: product,
    };
    for (final id in _favoriteService.productIds) {
      final product = MockProductDatabase.findById(id);
      if (product != null) {
        savedProducts.putIfAbsent(id, () => product);
      }
    }
    return WardrobeSnapshot(
      favoriteProducts: List<Product>.unmodifiable(savedProducts.values),
      outfitPlans: _favoriteService.favoriteOutfitPlans,
      tryOnHistory: _favoriteService.tryOnHistory,
      aiRecommendationHistory: _favoriteService.aiRecommendationHistory,
    );
  }

  @override
  Future<bool> toggleProduct(Product product) {
    return _favoriteService.toggleProduct(product);
  }

  @override
  Future<bool> toggleOutfitPlan(OutfitPlan plan) {
    return _favoriteService.toggleOutfitPlan(plan);
  }

  @override
  Future<void> saveTryOnRecord(TryOnRecord record) {
    return _favoriteService.addTryOnRecord(record);
  }

  @override
  Future<void> saveAIRecommendation(AIRecommendationRecord record) {
    return _favoriteService.addAIRecommendation(record);
  }
}
