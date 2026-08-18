import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/user_profile.dart';
import 'user_profile_repository.dart';

class LocalUserProfileRepository
    implements UserProfileRepository, DeletableUserProfileRepository {
  LocalUserProfileRepository({SharedPreferencesAsync? storage, String? userId})
      : _storage = storage,
        _key = keyForUser(userId);

  static const legacyKey = 'fitai.user_profile.v1';
  final String _key;
  SharedPreferencesAsync? _storage;

  static String keyForUser(String? userId) {
    final normalized = userId?.trim() ?? '';
    if (normalized.isEmpty) {
      return legacyKey;
    }
    final encoded =
        base64Url.encode(utf8.encode(normalized)).replaceAll('=', '');
    return '$legacyKey.user.$encoded';
  }

  @override
  Future<UserProfile?> load() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final value = await storage.getString(_key);
      if (value == null) {
        return null;
      }
      final json = jsonDecode(value);
      return json is Map<String, dynamic> ? UserProfile.fromJson(json) : null;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(UserProfile profile) async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setString(_key, jsonEncode(profile.toJson()));
    } catch (_) {
      // Local persistence must never block analysis, shopping, or try-on.
    }
  }

  @override
  Future<void> delete() async {
    final storage = _storage ??= SharedPreferencesAsync();
    await storage.remove(_key);
  }
}
