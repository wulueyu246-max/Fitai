import 'package:shared_preferences/shared_preferences.dart';

import '../models/user_profile.dart';
import '../repositories/local_user_profile_repository.dart';
import '../repositories/user_profile_repository.dart';

class UserProfileService {
  UserProfileService({
    SharedPreferencesAsync? storage,
    UserProfileRepository? repository,
  }) : _repository = repository ?? LocalUserProfileRepository(storage: storage);

  final UserProfileRepository _repository;
  UserProfile? _memory;

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

  Future<UserProfile> load() async {
    if (_memory case final profile?) {
      return profile;
    }
    try {
      return _memory = await _repository.load() ?? defaultProfile;
    } catch (_) {
      return _memory = defaultProfile;
    }
  }

  Future<void> save(UserProfile profile) async {
    _memory = profile;
    try {
      await _repository.save(profile);
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
    await save(updated);
    return updated;
  }

  Future<UserProfile> recordPurchase(
    UserProfile profile,
    String sku,
  ) async {
    final updated = profile.copyWith(
      purchaseHistory: _prependUnique(sku, profile.purchaseHistory, limit: 80),
    );
    await save(updated);
    return updated;
  }

  Future<UserProfile> recordTryOn(
    UserProfile profile,
    String productId,
  ) async {
    final updated = profile.copyWith(
      tryOnHistory: _prependUnique(
        productId,
        profile.tryOnHistory,
        limit: 80,
      ),
    );
    await save(updated);
    return updated;
  }

  Future<UserProfile> syncFavorites(
    UserProfile profile,
    Iterable<String> favoriteProductIds,
  ) async {
    final updated = profile.copyWith(
      favoriteProductIds: favoriteProductIds.toSet().toList(growable: false),
    );
    await save(updated);
    return updated;
  }

  Future<UserProfile> recordOutfit(
    UserProfile profile,
    String outfitPlanId,
  ) async {
    final updated = profile.copyWith(
      outfitHistory: _prependUnique(
        outfitPlanId,
        profile.outfitHistory,
        limit: 50,
      ),
    );
    await save(updated);
    return updated;
  }

  Future<UserProfile> deletePhotos(UserProfile profile) async {
    final updated = profile.copyWith(
      photos: const {},
      avatarBase64: '',
    );
    await save(updated);
    return updated;
  }

  Future<void> clear() async {
    _memory = null;
    final repository = _repository;
    if (repository is DeletableUserProfileRepository) {
      await (repository as DeletableUserProfileRepository).delete();
    }
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
