import 'package:flutter/foundation.dart';

import '../models/auth_session.dart';
import '../models/user_account.dart';
import '../repositories/auth_repository.dart';
import '../repositories/local_auth_repository.dart';
import '../../../services/user_profile_service.dart';

class UserSessionController extends ChangeNotifier {
  UserSessionController({
    AuthRepository? repository,
    UserProfileService? profileService,
  })  : _repository = repository ?? LocalAuthRepository(),
        _profileService = profileService ?? UserProfileService();

  static final UserSessionController instance = UserSessionController();

  final AuthRepository _repository;
  final UserProfileService _profileService;
  UserAccount? _account;
  AuthSession? _session;
  bool _loading = false;
  bool _initialized = false;
  String? _error;

  UserAccount? get account => _account;
  AuthSession? get session => _session;
  bool get isAuthenticated => _account != null && _session != null;
  bool get loading => _loading;
  String? get error => _error;

  Future<void> ensureLoaded() async {
    if (_initialized) {
      return;
    }
    _initialized = true;
    await _run(() async {
      final restored = await _repository.restoreSession();
      _account = restored?.account;
      _session = restored?.session;
      if (_account case final account?) {
        await _mirrorAccountToProfile(account);
      }
    });
  }

  Future<bool> register({
    required String email,
    required String password,
    required String displayName,
  }) async {
    return _runResult(() async {
      final result = await _repository.register(
        email: email,
        password: password,
        displayName: displayName,
      );
      final localProfile = await _profileService.load();
      _account = await _repository.updateProfile(
        result.account.copyWith(
          avatarBase64: localProfile.avatarBase64,
          height: localProfile.height,
          weight: localProfile.weight,
          age: localProfile.age,
          bodyType: localProfile.bodyType,
          likedStyles: localProfile.stylePreference,
          budgetMin: localProfile.budgetMin,
          budgetMax: localProfile.budgetMax,
          favoriteBrands: localProfile.favoriteBrands,
        ),
      );
      _session = result.session;
      await _mirrorAccountToProfile(_account!);
    });
  }

  Future<bool> login({
    required String email,
    required String password,
  }) async {
    return _runResult(() async {
      final result = await _repository.login(
        email: email,
        password: password,
      );
      _account = result.account;
      _session = result.session;
      await _mirrorAccountToProfile(result.account);
    });
  }

  Future<PhoneCodeChallenge?> requestPhoneCode(String phone) async {
    PhoneCodeChallenge? challenge;
    await _run(() async {
      final repository = _repository;
      if (repository is! PhoneAuthRepository) {
        throw const AuthException('手机号登录暂不可用');
      }
      challenge = await (repository as PhoneAuthRepository).requestPhoneCode(
        phone,
      );
    });
    return challenge;
  }

  Future<bool> loginWithPhoneCode({
    required String phone,
    required String code,
  }) async {
    return _runResult(() async {
      final repository = _repository;
      if (repository is! PhoneAuthRepository) {
        throw const AuthException('手机号登录暂不可用');
      }
      final result =
          await (repository as PhoneAuthRepository).loginWithPhoneCode(
        phone: phone,
        code: code,
      );
      _account = result.account;
      _session = result.session;
      await _mirrorAccountToProfile(result.account);
    });
  }

  Future<bool> updateProfile(UserAccount account) {
    return _runResult(() async {
      _account = await _repository.updateProfile(account);
      await _mirrorAccountToProfile(_account!);
    });
  }

  Future<bool> deleteAvatar() async {
    final current = _account;
    if (current == null) {
      return true;
    }
    return updateProfile(current.copyWith(clearAvatar: true));
  }

  Future<void> logout() async {
    await _run(() async {
      await _repository.logout();
      _account = null;
      _session = null;
    });
  }

  Future<bool> deleteAccount() {
    return _runResult(() async {
      final currentUserId = _account?.id;
      final repository = _repository;
      if (repository is! AccountDeletionRepository) {
        throw const AuthException('当前账号服务不支持注销');
      }
      await (repository as AccountDeletionRepository).deleteAccount();
      await _profileService.clear(userId: currentUserId);
      _account = null;
      _session = null;
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      await action();
    } on AuthException catch (error) {
      _error = error.message;
    } catch (_) {
      _error = '操作失败，请稍后重试';
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<bool> _runResult(Future<void> Function() action) async {
    await _run(action);
    return _error == null;
  }

  Future<void> _mirrorAccountToProfile(UserAccount account) async {
    final current = await _profileService.load(userId: account.id);
    await _profileService.save(
      current.copyWith(
        avatarBase64: account.avatarBase64,
        height: account.height,
        weight: account.weight,
        age: account.age,
        gender: account.gender,
        bodyType: account.bodyType,
        stylePreference: account.likedStyles,
        budgetMin: account.budgetMin,
        budgetMax: account.budgetMax,
        favoriteBrands: account.favoriteBrands,
      ),
      userId: account.id,
    );
  }
}
