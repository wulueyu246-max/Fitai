import '../models/auth_session.dart';
import '../models/user_account.dart';

class AuthResult {
  const AuthResult({required this.account, required this.session});

  final UserAccount account;
  final AuthSession session;
}

class PhoneCodeChallenge {
  const PhoneCodeChallenge({required this.expiresAt, this.debugCode});
  final DateTime expiresAt;
  final String? debugCode;
}

enum SocialAuthProvider { wechat, apple }

abstract interface class AuthRepository {
  Future<AuthResult> register({
    required String email,
    required String password,
    required String displayName,
  });

  Future<AuthResult> login({
    required String email,
    required String password,
  });

  Future<AuthResult?> restoreSession();

  Future<UserAccount> updateProfile(UserAccount account);

  Future<void> logout();
}

abstract interface class PhoneAuthRepository {
  Future<PhoneCodeChallenge> requestPhoneCode(String phone);

  Future<AuthResult> loginWithPhoneCode({
    required String phone,
    required String code,
  });
}

abstract interface class SocialAuthRepository {
  Future<AuthResult> loginWithSocial(SocialAuthProvider provider);
}

abstract interface class AccountDeletionRepository {
  Future<void> deleteAccount();
}

class AuthException implements Exception {
  const AuthException(this.message);

  final String message;

  @override
  String toString() => message;
}
