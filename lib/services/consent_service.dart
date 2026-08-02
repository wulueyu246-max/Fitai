import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/user_consent.dart';

class ConsentService {
  ConsentService({SharedPreferencesAsync? storage}) : _storage = storage;

  static final ConsentService instance = ConsentService();
  static const _key = 'fitai.user_consent.v1';

  SharedPreferencesAsync? _storage;
  UserConsent? _memory;

  Future<UserConsent> load() async {
    if (_memory case final consent?) {
      return consent;
    }
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final value = await storage.getString(_key);
      if (value != null) {
        final decoded = jsonDecode(value);
        if (decoded is Map<String, dynamic>) {
          _memory = UserConsent.fromJson(decoded);
          return _memory!;
        }
      }
    } catch (_) {
      // Consent stays explicit and defaults to denied.
    }
    return _memory = UserConsent.empty;
  }

  Future<UserConsent> grantRequiredConsent() async {
    final updated = UserConsent.empty.copyWith(
      acceptedTerms: true,
      acceptedPrivacy: true,
      photoProcessingAllowed: true,
      updatedAt: DateTime.now(),
    );
    await save(updated);
    return updated;
  }

  Future<UserConsent> save(UserConsent consent) async {
    _memory = consent.copyWith(updatedAt: DateTime.now());
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setString(_key, jsonEncode(_memory!.toJson()));
    } catch (_) {
      // In-memory consent remains available for this local session.
    }
    return _memory!;
  }

  Future<UserConsent> revokePhotoProcessing() async {
    final current = await load();
    return save(current.copyWith(photoProcessingAllowed: false));
  }

  Future<void> clear() async {
    _memory = null;
    final storage = _storage ??= SharedPreferencesAsync();
    await storage.remove(_key);
  }
}
