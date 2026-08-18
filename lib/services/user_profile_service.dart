import 'package:shared_preferences/shared_preferences.dart';

import '../models/user_profile.dart';
import '../repositories/local_user_profile_repository.dart';
import '../repositories/user_profile_repository.dart';

enum UserProfileScope { currentUser, legacyUnscoped, none }

extension UserProfileScopeLogValue on UserProfileScope {
  String get logValue => switch (this) {
        UserProfileScope.currentUser => 'CURRENT_USER',
        UserProfileScope.legacyUnscoped => 'LEGACY_UNSCOPED',
        UserProfileScope.none => 'NONE',
      };
}

class UserProfileSnapshot {
  const UserProfileSnapshot({
    required this.profile,
    required this.scope,
    required this.userMatch,
  });

  final UserProfile profile;
  final UserProfileScope scope;
  final bool userMatch;
}

class UserProfileService {
  UserProfileService({
    SharedPreferencesAsync? storage,
    UserProfileRepository? repository,
  })  : _storage = storage,
        _repositoryOverride = repository;

  final SharedPreferencesAsync? _storage;
  final UserProfileRepository? _repositoryOverride;
  final Map<String, UserProfileSnapshot> _memory = {};

  static const defaultProfile = UserProfile(
    height: 173,
    weight: 60,
    age: 25,
    bodyType: '偏瘦体型',
    stylePreference: ['通勤', '极简', '高级感'],
    favoriteColors: ['黑色', '白色', '深灰色'],
    favoriteBrands: ['Uniqlo', 'COS', 'Nike'],
    purchaseHistory: [],
    tryOnHistory: [],
  );

  Future<UserProfile> load({String? userId}) async {
    return (await loadScoped(userId: userId)).profile;
  }

  Future<UserProfileSnapshot> loadScoped({String? userId}) async {
    final normalizedUserId = userId?.trim() ?? '';
    final memoryKey = _memoryKey(normalizedUserId);
    if (_memory[memoryKey] case final snapshot?) {
      return snapshot;
    }
    try {
      var persisted = await _repositoryFor(normalizedUserId).load();
      if (persisted == null && normalizedUserId.isNotEmpty) {
        final legacy =
            _memory[_memoryKey('')]?.profile ?? await _repositoryFor('').load();
        if (legacy != null) {
          persisted = legacy.copyWith(gender: defaultProfile.gender);
          try {
            await _repositoryFor(normalizedUserId).save(persisted);
          } catch (_) {
            // Migration is best effort; the in-memory scoped copy remains safe.
          }
        }
      }
      final profile = persisted ?? defaultProfile;
      final snapshot = UserProfileSnapshot(
        profile: profile,
        scope: persisted == null
            ? UserProfileScope.none
            : normalizedUserId.isEmpty
                ? UserProfileScope.legacyUnscoped
                : UserProfileScope.currentUser,
        userMatch: persisted != null && normalizedUserId.isNotEmpty,
      );
      _memory[memoryKey] = snapshot;
      return snapshot;
    } catch (_) {
      const snapshot = UserProfileSnapshot(
        profile: defaultProfile,
        scope: UserProfileScope.none,
        userMatch: false,
      );
      _memory[memoryKey] = snapshot;
      return snapshot;
    }
  }

  Future<void> save(UserProfile profile, {String? userId}) async {
    final normalizedUserId = userId?.trim() ?? '';
    _memory[_memoryKey(normalizedUserId)] = UserProfileSnapshot(
      profile: profile,
      scope: normalizedUserId.isEmpty
          ? UserProfileScope.legacyUnscoped
          : UserProfileScope.currentUser,
      userMatch: normalizedUserId.isNotEmpty,
    );
    try {
      await _repositoryFor(normalizedUserId).save(profile);
    } catch (_) {
      // A future cloud outage must not block analysis, shopping, or try-on.
    }
  }

  Future<UserProfile> mergeAnalysis({
    required UserProfile profile,
    required double height,
    required double weight,
    required String bodyType,
    required String style,
    Map<String, String>? photos,
    Iterable<String>? favoriteProductIds,
    String? userId,
  }) async {
    final styles = _prependUnique(style, profile.stylePreference);
    final updated = profile.copyWith(
      height: height,
      weight: weight,
      bodyType: bodyType,
      stylePreference: styles,
      photos: photos,
      favoriteProductIds: favoriteProductIds?.toList(growable: false),
    );
    await save(updated, userId: userId);
    return updated;
  }

  Future<UserProfile> recordPurchase(UserProfile profile, String sku,
      {String? userId}) async {
    final updated = profile.copyWith(
      purchaseHistory: _prependUnique(sku, profile.purchaseHistory, limit: 80),
    );
    await save(updated, userId: userId);
    return updated;
  }

  Future<UserProfile> recordTryOn(UserProfile profile, String productId,
      {String? userId}) async {
    final updated = profile.copyWith(
      tryOnHistory: _prependUnique(
        productId,
        profile.tryOnHistory,
        limit: 80,
      ),
    );
    await save(updated, userId: userId);
    return updated;
  }

  Future<UserProfile> syncFavorites(
      UserProfile profile, Iterable<String> favoriteProductIds,
      {String? userId}) async {
    final updated = profile.copyWith(
      favoriteProductIds: favoriteProductIds.toSet().toList(growable: false),
    );
    await save(updated, userId: userId);
    return updated;
  }

  Future<UserProfile> recordOutfit(UserProfile profile, String outfitPlanId,
      {String? userId}) async {
    final updated = profile.copyWith(
      outfitHistory: _prependUnique(
        outfitPlanId,
        profile.outfitHistory,
        limit: 50,
      ),
    );
    await save(updated, userId: userId);
    return updated;
  }

  Future<UserProfile> deletePhotos(UserProfile profile,
      {String? userId}) async {
    final updated = profile.copyWith(
      photos: const {},
      avatarBase64: '',
    );
    await save(updated, userId: userId);
    return updated;
  }

  Future<void> clear({String? userId}) async {
    final normalizedUserId = userId?.trim() ?? '';
    _memory.remove(_memoryKey(normalizedUserId));
    final repository = _repositoryFor(normalizedUserId);
    if (repository is DeletableUserProfileRepository) {
      await (repository as DeletableUserProfileRepository).delete();
    }
  }

  String _memoryKey(String userId) =>
      userId.isEmpty ? 'legacy' : 'user:$userId';

  UserProfileRepository _repositoryFor(String userId) {
    final override = _repositoryOverride;
    if (override != null) {
      return override;
    }
    return LocalUserProfileRepository(
      storage: _storage,
      userId: userId.isEmpty ? null : userId,
    );
  }

  List<String> _prependUnique(
    String value,
    List<String> current, {
    int limit = 20,
  }) {
    final normalized = value.trim();
    if (normalized.isEmpty) {
      return current;
    }
    return [
      normalized,
      ...current.where((item) => item != normalized),
    ].take(limit).toList(growable: false);
  }
}
