import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/user_preference.dart';

class UserPreferenceService {
  UserPreferenceService({SharedPreferencesAsync? storage}) : _storage = storage;

  static const _key = 'fitai.user_preference';
  SharedPreferencesAsync? _storage;

  static const defaultPreference = UserPreference(
    likedStyles: ['通勤', '极简', '高级感'],
    likedColors: ['黑色', '白色', '深灰色'],
    bodyFeatures: ['肩部线条偏窄', '腿长比例均衡'],
    purchaseHistory: [],
    browsingHistory: [],
  );

  Future<UserPreference> load() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final value = await storage.getString(_key);
      if (value == null) {
        return defaultPreference;
      }
      final json = jsonDecode(value);
      return json is Map<String, dynamic>
          ? UserPreference.fromJson(json)
          : defaultPreference;
    } catch (_) {
      return defaultPreference;
    }
  }

  Future<void> save(UserPreference preference) async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setString(_key, jsonEncode(preference.toJson()));
    } catch (_) {
      // The recommendation flow remains usable with in-memory preferences.
    }
  }

  Future<UserPreference> recordBrowse(
    UserPreference preference,
    String postId,
  ) async {
    final history = [
      postId,
      ...preference.browsingHistory.where((id) => id != postId),
    ].take(50).toList(growable: false);
    final updated = preference.copyWith(browsingHistory: history);
    await save(updated);
    return updated;
  }

  Future<UserPreference> recordPurchase(
    UserPreference preference,
    String sku,
  ) async {
    final history = [
      sku,
      ...preference.purchaseHistory.where((id) => id != sku),
    ].take(50).toList(growable: false);
    final updated = preference.copyWith(purchaseHistory: history);
    await save(updated);
    return updated;
  }
}
