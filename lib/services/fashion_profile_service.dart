import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../data/mock_product_database.dart';
import '../models/fashion_profile.dart';
import '../models/product.dart';
import '../models/product_analytics.dart';
import '../models/user_preference.dart';
import '../models/user_profile.dart';

class FashionProfileService {
  FashionProfileService({SharedPreferencesAsync? storage}) : _storage = storage;

  static const _key = 'fitai.fashion_profile.v1';
  SharedPreferencesAsync? _storage;

  Future<FashionProfile> loadOrCreate({
    required UserProfile profile,
    required UserPreference preference,
  }) async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final value = await storage.getString(_key);
      if (value != null) {
        final json = jsonDecode(value);
        if (json is Map<String, dynamic>) {
          return FashionProfile.fromJson(json);
        }
      }
    } catch (_) {
      // Fall through to a profile derived from existing local knowledge.
    }
    final created = FashionProfile.fromUserData(
      profile: profile,
      preference: preference,
    );
    await save(created);
    return created;
  }

  Future<void> save(FashionProfile profile) async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setString(_key, jsonEncode(profile.toJson()));
    } catch (_) {
      // Feed continues with the in-memory profile.
    }
  }

  Future<FashionProfile> recordBrand(
    FashionProfile profile,
    String brand,
  ) async {
    final updated = profile.copyWith(
      likedBrands: [
        brand,
        ...profile.likedBrands.where(
          (item) => item.toLowerCase() != brand.toLowerCase(),
        ),
      ].take(20).toList(growable: false),
    );
    await save(updated);
    return updated;
  }

  Future<FashionProfile> recordPurchase(
    FashionProfile profile,
    String sku,
  ) async {
    final updated = profile.copyWith(
      purchaseHistory: [
        sku,
        ...profile.purchaseHistory.where((item) => item != sku),
      ].take(80).toList(growable: false),
    );
    await save(updated);
    return updated;
  }

  Future<FashionProfile> generateAIProfile({
    required FashionProfile base,
    required Iterable<ProductAnalyticsEvent> productEvents,
    required Iterable<Product> favoriteProducts,
    int photoAnalysisCount = 0,
  }) async {
    final productsById = {
      for (final product in MockProductDatabase.products) product.id: product,
      for (final product in favoriteProducts) product.id: product,
    };
    final styleScores = <String, int>{};
    final brandScores = <String, int>{};
    for (final product in favoriteProducts) {
      styleScores[product.style] = (styleScores[product.style] ?? 0) + 5;
      brandScores[product.brand] = (brandScores[product.brand] ?? 0) + 4;
    }
    for (final event in productEvents) {
      final product = productsById[event.productId];
      if (product == null) {
        continue;
      }
      final weight = switch (event.action) {
        ProductAnalyticsAction.impression => 0,
        ProductAnalyticsAction.click => 1,
        ProductAnalyticsAction.favorite => 4,
        ProductAnalyticsAction.tryOn => 6,
        ProductAnalyticsAction.purchaseRedirect => 8,
        ProductAnalyticsAction.purchaseCompleted => 12,
      };
      styleScores[product.style] = (styleScores[product.style] ?? 0) + weight;
      brandScores[product.brand] = (brandScores[product.brand] ?? 0) + weight;
    }

    final rankedStyles = _rank(styleScores);
    final rankedBrands = _rank(brandScores);
    final sourceStyles = rankedStyles.isEmpty ? base.likedStyles : rankedStyles;
    final labels =
        sourceStyles.map(_personaLabel).toSet().take(3).toList(growable: false);
    final behaviorCount = productEvents.length;
    final confidence =
        (0.35 + behaviorCount * 0.025 + photoAnalysisCount * 0.08)
            .clamp(0.35, 0.96)
            .toDouble();
    final generated = base.copyWith(
      likedStyles: {
        ...rankedStyles,
        ...base.likedStyles,
      }.take(12).toList(growable: false),
      likedBrands: {
        ...rankedBrands,
        ...base.likedBrands,
      }.take(20).toList(growable: false),
      personaLabels: labels,
      evidence: [
        if (photoAnalysisCount > 0) '$photoAnalysisCount 次照片/AI分析',
        '$behaviorCount 条商品行为',
        '${favoriteProducts.length} 件收藏商品',
        '${base.purchaseHistory.length} 条购买记录',
      ],
      confidence: confidence,
      generatedAt: DateTime.now(),
    );
    await save(generated);
    return generated;
  }

  List<String> _rank(Map<String, int> scores) {
    final entries = scores.entries.toList()
      ..sort((left, right) {
        final comparison = right.value.compareTo(left.value);
        return comparison != 0 ? comparison : left.key.compareTo(right.key);
      });
    return entries.map((entry) => entry.key).toList(growable: false);
  }

  String _personaLabel(String style) {
    if (style.contains('商务') || style.contains('通勤')) {
      return '商务休闲';
    }
    if (style.contains('日系') || style.contains('极简')) {
      return '日系简约';
    }
    if (style.contains('街头')) {
      return '街头风';
    }
    if (style.contains('运动')) {
      return '运动风';
    }
    return style;
  }
}
