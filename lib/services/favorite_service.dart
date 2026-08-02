import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/ai_recommendation_record.dart';
import '../models/outfit_plan.dart';
import '../models/product.dart';
import '../models/try_on_record.dart';
import '../models/wardrobe_snapshot.dart';

class FavoriteService extends ChangeNotifier {
  FavoriteService({SharedPreferencesAsync? storage}) : _storage = storage;

  static final FavoriteService instance = FavoriteService();

  static const _productKey = 'fitai.favorite_products';
  static const _outfitPlanKey = 'fitai.favorite_outfit_plans';
  static const _productDataKey = 'fitai.favorite_product_data';
  static const _outfitPlanDataKey = 'fitai.favorite_outfit_plan_data';
  static const _tryOnHistoryKey = 'fitai.try_on_history';
  static const _aiRecommendationHistoryKey = 'fitai.ai_recommendation_history';

  SharedPreferencesAsync? _storage;
  final Set<String> _productIds = {};
  final Set<String> _outfitPlanIds = {};
  final Map<String, Product> _products = {};
  final Map<String, OutfitPlan> _outfitPlans = {};
  final List<TryOnRecord> _tryOnHistory = [];
  final List<AIRecommendationRecord> _aiRecommendationHistory = [];
  Future<void>? _loadFuture;

  bool get isLoaded => _loadFuture != null;
  Set<String> get productIds => Set<String>.unmodifiable(_productIds);
  Set<String> get outfitPlanIds => Set<String>.unmodifiable(_outfitPlanIds);
  List<Product> get favoriteProducts =>
      List<Product>.unmodifiable(_products.values);
  List<OutfitPlan> get favoriteOutfitPlans =>
      List<OutfitPlan>.unmodifiable(_outfitPlans.values);
  List<TryOnRecord> get tryOnHistory =>
      List<TryOnRecord>.unmodifiable(_tryOnHistory);
  List<AIRecommendationRecord> get aiRecommendationHistory =>
      List<AIRecommendationRecord>.unmodifiable(_aiRecommendationHistory);

  Future<void> ensureLoaded() {
    return _loadFuture ??= _loadSafely();
  }

  bool isProductFavorite(String productId) => _productIds.contains(productId);

  bool isOutfitPlanFavorite(String planId) => _outfitPlanIds.contains(planId);

  Future<bool> toggleProduct(Product product) async {
    await ensureLoaded();
    final isFavorite = _toggle(_productIds, product.id);
    if (isFavorite) {
      _products[product.id] = product;
    } else {
      _products.remove(product.id);
    }
    notifyListeners();
    await Future.wait([
      _writeList(_productKey, _productIds),
      _writeJsonList(
        _productDataKey,
        _products.values.map((item) => item.toJson()),
      ),
    ]);
    return isFavorite;
  }

  Future<bool> toggleOutfitPlan(OutfitPlan plan) async {
    await ensureLoaded();
    final isFavorite = _toggle(_outfitPlanIds, plan.id);
    if (isFavorite) {
      _outfitPlans[plan.id] = plan;
    } else {
      _outfitPlans.remove(plan.id);
    }
    notifyListeners();
    await Future.wait([
      _writeList(_outfitPlanKey, _outfitPlanIds),
      _writeJsonList(
        _outfitPlanDataKey,
        _outfitPlans.values.map((item) => item.toJson()),
      ),
    ]);
    return isFavorite;
  }

  Future<void> addTryOnRecord(TryOnRecord record) async {
    await ensureLoaded();
    _tryOnHistory.removeWhere((item) => item.id == record.id);
    _tryOnHistory.insert(0, record);
    if (_tryOnHistory.length > 20) {
      _tryOnHistory.removeRange(20, _tryOnHistory.length);
    }
    notifyListeners();
    await _writeJsonList(
      _tryOnHistoryKey,
      _tryOnHistory.map((item) => item.toJson()),
    );
  }

  Future<void> addAIRecommendation(AIRecommendationRecord record) async {
    await ensureLoaded();
    _aiRecommendationHistory.removeWhere((item) => item.id == record.id);
    _aiRecommendationHistory.insert(0, record);
    if (_aiRecommendationHistory.length > 30) {
      _aiRecommendationHistory.removeRange(
        30,
        _aiRecommendationHistory.length,
      );
    }
    notifyListeners();
    await _writeJsonList(
      _aiRecommendationHistoryKey,
      _aiRecommendationHistory.map((item) => item.toJson()),
    );
  }

  Future<void> mergeSnapshot(WardrobeSnapshot snapshot) async {
    await ensureLoaded();
    for (final product in snapshot.favoriteProducts) {
      _productIds.add(product.id);
      _products[product.id] = product;
    }
    for (final plan in snapshot.outfitPlans) {
      _outfitPlanIds.add(plan.id);
      _outfitPlans[plan.id] = plan;
    }
    _mergeHistory<TryOnRecord>(
      _tryOnHistory,
      snapshot.tryOnHistory,
      idOf: (item) => item.id,
      createdAtOf: (item) => item.createdTime,
      limit: 20,
    );
    _mergeHistory<AIRecommendationRecord>(
      _aiRecommendationHistory,
      snapshot.aiRecommendationHistory,
      idOf: (item) => item.id,
      createdAtOf: (item) => item.createdTime,
      limit: 30,
    );
    notifyListeners();
    await Future.wait([
      _writeList(_productKey, _productIds),
      _writeList(_outfitPlanKey, _outfitPlanIds),
      _writeJsonList(
        _productDataKey,
        _products.values.map((item) => item.toJson()),
      ),
      _writeJsonList(
        _outfitPlanDataKey,
        _outfitPlans.values.map((item) => item.toJson()),
      ),
      _writeJsonList(
        _tryOnHistoryKey,
        _tryOnHistory.map((item) => item.toJson()),
      ),
      _writeJsonList(
        _aiRecommendationHistoryKey,
        _aiRecommendationHistory.map((item) => item.toJson()),
      ),
    ]);
  }

  WardrobeSnapshot get snapshot => WardrobeSnapshot(
        favoriteProducts: favoriteProducts,
        outfitPlans: favoriteOutfitPlans,
        tryOnHistory: tryOnHistory,
        aiRecommendationHistory: aiRecommendationHistory,
      );

  Future<void> clearAll() async {
    await ensureLoaded();
    _productIds.clear();
    _outfitPlanIds.clear();
    _products.clear();
    _outfitPlans.clear();
    _tryOnHistory.clear();
    _aiRecommendationHistory.clear();
    notifyListeners();
    final storage = _storage ??= SharedPreferencesAsync();
    await Future.wait([
      storage.remove(_productKey),
      storage.remove(_outfitPlanKey),
      storage.remove(_productDataKey),
      storage.remove(_outfitPlanDataKey),
      storage.remove(_tryOnHistoryKey),
      storage.remove(_aiRecommendationHistoryKey),
    ]);
  }

  Future<void> _load() async {
    final storage = _storage ??= SharedPreferencesAsync();
    final values = await Future.wait([
      storage.getStringList(_productKey),
      storage.getStringList(_outfitPlanKey),
      storage.getStringList(_productDataKey),
      storage.getStringList(_outfitPlanDataKey),
      storage.getStringList(_tryOnHistoryKey),
      storage.getStringList(_aiRecommendationHistoryKey),
    ]);
    _productIds
      ..clear()
      ..addAll(values[0] ?? const []);
    _outfitPlanIds
      ..clear()
      ..addAll(values[1] ?? const []);
    _products
      ..clear()
      ..addEntries(
        _decodeJsonObjects(values[2])
            .map(Product.fromJson)
            .map((product) => MapEntry(product.id, product)),
      );
    _outfitPlans
      ..clear()
      ..addEntries(
        _decodeJsonObjects(values[3])
            .map(OutfitPlan.fromJson)
            .map((plan) => MapEntry(plan.id, plan)),
      );
    _tryOnHistory
      ..clear()
      ..addAll(_decodeJsonObjects(values[4]).map(TryOnRecord.fromJson));
    _aiRecommendationHistory
      ..clear()
      ..addAll(
        _decodeJsonObjects(values[5]).map(AIRecommendationRecord.fromJson),
      );
    notifyListeners();
  }

  Future<void> _loadSafely() async {
    try {
      await _load();
    } catch (_) {
      // Keep the in-memory state usable when a platform store is unavailable.
    }
  }

  Future<void> _writeList(String key, Set<String> values) async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setStringList(key, values.toList()..sort());
    } catch (_) {
      // Persistence failure must not break the shopping and try-on flow.
    }
  }

  Future<void> _writeJsonList(
    String key,
    Iterable<Map<String, dynamic>> values,
  ) async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setStringList(
        key,
        values.map(jsonEncode).toList(growable: false),
      );
    } catch (_) {
      // Keep the in-memory wardrobe available if local persistence fails.
    }
  }

  List<Map<String, dynamic>> _decodeJsonObjects(List<String>? values) {
    if (values == null) {
      return const [];
    }
    final decoded = <Map<String, dynamic>>[];
    for (final value in values) {
      try {
        final item = jsonDecode(value);
        if (item is Map<String, dynamic>) {
          decoded.add(item);
        }
      } catch (_) {
        // Ignore one damaged local record without dropping the whole wardrobe.
      }
    }
    return decoded;
  }

  bool _toggle(Set<String> target, String id) {
    if (target.remove(id)) {
      return false;
    }
    target.add(id);
    return true;
  }

  void _mergeHistory<T>(
    List<T> target,
    Iterable<T> remote, {
    required String Function(T item) idOf,
    required DateTime Function(T item) createdAtOf,
    required int limit,
  }) {
    final merged = <String, T>{for (final item in target) idOf(item): item};
    for (final item in remote) {
      merged[idOf(item)] = item;
    }
    final values = merged.values.toList()
      ..sort((left, right) => createdAtOf(right).compareTo(createdAtOf(left)));
    target
      ..clear()
      ..addAll(values.take(limit));
  }
}
