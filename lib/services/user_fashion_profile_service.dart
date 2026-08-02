import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/fashion_profile.dart';
import '../models/user_fashion_profile.dart';
import '../models/user_profile.dart';

class UserFashionProfileService {
  UserFashionProfileService({SharedPreferencesAsync? storage})
      : _storage = storage;

  static const _key = 'fitai.user_fashion_profile.v1';
  SharedPreferencesAsync? _storage;
  UserFashionProfile? _memory;

  Future<UserFashionProfile> loadOrCreate({
    required UserProfile user,
    required FashionProfile fashion,
  }) async {
    if (_memory case final cached?) {
      return _mergeCore(cached, user, fashion);
    }
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final value = await storage.getString(_key);
      if (value != null) {
        final decoded = jsonDecode(value);
        if (decoded is Map<String, dynamic>) {
          _memory = _mergeCore(
            UserFashionProfile.fromJson(decoded),
            user,
            fashion,
          );
          return _memory!;
        }
      }
    } catch (_) {
      // The personalized feed stays available when local storage is absent.
    }
    _memory = UserFashionProfile.fromProfiles(user: user, fashion: fashion);
    return _memory!;
  }

  Future<UserFashionProfile> recordClick(
    UserFashionProfile profile,
    String productId,
  ) async {
    final updated = profile.copyWith(
      clickHistory: [
        productId,
        ...profile.clickHistory.where((id) => id != productId),
      ].take(100).toList(growable: false),
    );
    await save(updated);
    return updated;
  }

  Future<UserFashionProfile> save(UserFashionProfile profile) async {
    _memory = profile;
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setString(_key, jsonEncode(profile.toJson()));
    } catch (_) {
      // Personalization never blocks product browsing.
    }
    return profile;
  }

  UserFashionProfile _mergeCore(
    UserFashionProfile current,
    UserProfile user,
    FashionProfile fashion,
  ) {
    return current.copyWith(
      height: user.height,
      weight: user.weight,
      bodyType: user.bodyType,
      favoriteColors: {
        ...current.favoriteColors,
        ...user.favoriteColors,
        ...fashion.commonColors,
      }.toList(growable: false),
      favoriteBrands: {
        ...current.favoriteBrands,
        ...user.favoriteBrands,
        ...fashion.likedBrands,
      }.toList(growable: false),
      budgetMin: fashion.budgetMin,
      budgetMax: fashion.budgetMax,
    );
  }
}
