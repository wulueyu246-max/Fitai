import '../models/user_profile.dart';

/// Persistence boundary for local Mock storage today and a cloud database later.
abstract interface class UserProfileRepository {
  Future<UserProfile?> load();

  Future<void> save(UserProfile profile);
}

abstract interface class DeletableUserProfileRepository {
  Future<void> delete();
}
