import 'package:fit_ai/models/outfit_request.dart';
import 'package:fit_ai/models/user_profile.dart';
import 'package:fit_ai/repositories/local_user_profile_repository.dart';
import 'package:fit_ai/repositories/user_profile_repository.dart';
import 'package:fit_ai/services/user_profile_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'legacy body data remains readable but legacy gender is non-authoritative',
    () async {
      final legacyProfile = UserProfileService.defaultProfile.copyWith(
        height: 160,
        weight: 49,
        gender: 'male',
      );
      final service = UserProfileService(
        repository: _MemoryProfileRepository(legacyProfile),
      );

      final legacy = await service.loadScoped();
      final resolution = resolveOutfitGender(
        profileGender: legacy.profile.gender,
        profileScope: legacy.scope.logValue,
        profileUserMatch: legacy.userMatch,
      );

      expect(legacy.scope, UserProfileScope.legacyUnscoped);
      expect(legacy.userMatch, isFalse);
      expect(legacy.profile.height, 160);
      expect(legacy.profile.weight, 49);
      expect(legacy.profile.gender, 'male');
      expect(resolution.gender, 'unisex');
    },
  );

  test('current-user profile cache is isolated by user id', () async {
    final currentKey = LocalUserProfileRepository.keyForUser('current-user');
    final otherKey = LocalUserProfileRepository.keyForUser('other-user');
    expect(currentKey, isNot(LocalUserProfileRepository.legacyKey));
    expect(otherKey, isNot(LocalUserProfileRepository.legacyKey));
    expect(currentKey, isNot(otherKey));

    final service = UserProfileService(
      repository: _MemoryProfileRepository(
        UserProfileService.defaultProfile.copyWith(gender: 'female'),
      ),
    );
    final current = await service.loadScoped(userId: 'current-user');

    expect(current.scope, UserProfileScope.currentUser);
    expect(current.userMatch, isTrue);
    expect(current.profile.gender, 'female');
  });

  test('resolved gender stays identical across the complete request payload',
      () {
    final resolution = resolveOutfitGender(
      accountGender: 'unisex',
      initialGender: 'female',
      profileGender: 'male',
      accountIsCurrentUser: true,
      initialIsCurrentFlow: true,
      profileScope: OutfitProfileScope.legacyUnscoped,
    );
    final payload = OutfitRequest(
      height: 160,
      weight: 49,
      scene: '日常',
      request: '我要出去玩，帮我搭配一套',
      gender: resolution.gender,
      bodyProfile: const {'body_type': '纤细'},
      images: const {'front': 'data:image/jpeg;base64,AA=='},
    ).toJson();
    final context = payload['context']! as Map<String, dynamic>;
    final bodyProfile = context['body_profile']! as Map<String, dynamic>;

    expect(payload['gender'], 'female');
    expect(context['gender'], 'female');
    expect(bodyProfile['gender'], 'female');
  });
}

class _MemoryProfileRepository implements UserProfileRepository {
  _MemoryProfileRepository(this.profile);

  UserProfile? profile;

  @override
  Future<UserProfile?> load() async => profile;

  @override
  Future<void> save(UserProfile profile) async {
    this.profile = profile;
  }
}
