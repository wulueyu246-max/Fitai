import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/auth_session.dart';
import '../models/user_account.dart';
import 'auth_repository.dart';

class LocalAuthRepository
    implements
        AuthRepository,
        PhoneAuthRepository,
        SocialAuthRepository,
        AccountDeletionRepository {
  LocalAuthRepository({SharedPreferencesAsync? storage}) : _storage = storage;

  static const _accountKey = 'fitai.auth.account.v1';
  static const _credentialKey = 'fitai.auth.credential.v1';
  static const _sessionKey = 'fitai.auth.session.v1';

  SharedPreferencesAsync? _storage;
  UserAccount? _account;
  String? _salt;
  String? _passwordHash;
  AuthSession? _session;
  bool _loaded = false;
  String? _pendingPhone;
  String? _pendingCode;
  DateTime? _codeExpiresAt;

  @override
  Future<AuthResult> register({
    required String email,
    required String password,
    required String displayName,
  }) async {
    await _load();
    final normalizedEmail = _validateEmail(email);
    _validatePassword(password);
    if (_account?.email.toLowerCase() == normalizedEmail) {
      throw const AuthException('该邮箱已经注册，请直接登录');
    }
    final now = DateTime.now();
    final salt = sha256
        .convert(utf8.encode('$normalizedEmail:${now.microsecondsSinceEpoch}'))
        .toString()
        .substring(0, 24);
    final account = UserAccount(
      id: 'user-${sha256.convert(utf8.encode(normalizedEmail)).toString().substring(0, 16)}',
      email: normalizedEmail,
      displayName: displayName.trim().isEmpty ? '树皮用户' : displayName.trim(),
      height: 173,
      weight: 60,
      bodyType: '匀称体型',
      likedStyles: const ['极简', '通勤'],
      budgetMin: 100,
      budgetMax: 1200,
      favoriteBrands: const ['UNIQLO', 'Nike'],
      createdAt: now,
    );
    _account = account;
    _salt = salt;
    _passwordHash = _hashPassword(password, salt);
    _session = _createSession(account.id);
    await _save();
    return AuthResult(account: account, session: _session!);
  }

  @override
  Future<AuthResult> login({
    required String email,
    required String password,
  }) async {
    await _load();
    final normalizedEmail = _validateEmail(email);
    _validatePassword(password);
    final account = _account;
    final salt = _salt;
    if (account == null ||
        salt == null ||
        account.email.toLowerCase() != normalizedEmail ||
        _hashPassword(password, salt) != _passwordHash) {
      throw const AuthException('邮箱或密码不正确');
    }
    _session = _createSession(account.id);
    await _saveSession();
    return AuthResult(account: account, session: _session!);
  }

  @override
  Future<PhoneCodeChallenge> requestPhoneCode(String phone) async {
    final normalized = _validatePhone(phone);
    final code = (100000 + Random.secure().nextInt(900000)).toString();
    _pendingPhone = normalized;
    _pendingCode = code;
    _codeExpiresAt = DateTime.now().add(const Duration(minutes: 5));
    return PhoneCodeChallenge(expiresAt: _codeExpiresAt!, debugCode: code);
  }

  @override
  Future<AuthResult> loginWithPhoneCode({
    required String phone,
    required String code,
  }) async {
    await _load();
    final normalized = _validatePhone(phone);
    if (_pendingPhone != normalized ||
        _pendingCode != code.trim() ||
        _codeExpiresAt == null ||
        _codeExpiresAt!.isBefore(DateTime.now())) {
      throw const AuthException('验证码无效或已过期');
    }
    final now = DateTime.now();
    final existing = _account;
    final account = existing?.phone == normalized
        ? existing!
        : UserAccount(
            id: 'phone-${sha256.convert(utf8.encode(normalized)).toString().substring(0, 16)}',
            email: '',
            phone: normalized,
            displayName: '树皮用户 ${normalized.substring(normalized.length - 4)}',
            height: 173,
            weight: 60,
            bodyType: '匀称体型',
            likedStyles: const ['极简', '通勤'],
            budgetMin: 100,
            budgetMax: 1200,
            favoriteBrands: const ['UNIQLO', 'Nike'],
            createdAt: now,
          );
    _account = account;
    _session = _createSession(account.id);
    _pendingCode = null;
    await Future.wait([_saveAccount(), _saveSession()]);
    return AuthResult(account: account, session: _session!);
  }

  @override
  Future<AuthResult> loginWithSocial(SocialAuthProvider provider) {
    throw const AuthException('该登录方式即将开放');
  }

  @override
  Future<AuthResult?> restoreSession() async {
    await _load();
    final account = _account;
    final session = _session;
    if (account == null ||
        session == null ||
        session.userId != account.id ||
        session.isExpired) {
      return null;
    }
    return AuthResult(account: account, session: session);
  }

  @override
  Future<UserAccount> updateProfile(UserAccount account) async {
    await _load();
    if (_account?.id != account.id) {
      throw const AuthException('登录状态已失效，请重新登录');
    }
    _account = account;
    await _saveAccount();
    return account;
  }

  @override
  Future<void> logout() async {
    await _load();
    _session = null;
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.remove(_sessionKey);
    } catch (_) {
      // Local logout still succeeds when persistence is unavailable.
    }
  }

  @override
  Future<void> deleteAccount() async {
    await _load();
    _account = null;
    _salt = null;
    _passwordHash = null;
    _session = null;
    _pendingPhone = null;
    _pendingCode = null;
    _codeExpiresAt = null;
    final storage = _storage ??= SharedPreferencesAsync();
    await Future.wait([
      storage.remove(_accountKey),
      storage.remove(_credentialKey),
      storage.remove(_sessionKey),
    ]);
  }

  Future<void> _load() async {
    if (_loaded) {
      return;
    }
    _loaded = true;
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final accountValue = await storage.getString(_accountKey);
      final credentialValue = await storage.getString(_credentialKey);
      final sessionValue = await storage.getString(_sessionKey);
      if (accountValue != null) {
        _account = UserAccount.fromJson(
          jsonDecode(accountValue) as Map<String, dynamic>,
        );
      }
      if (credentialValue != null) {
        final credential = jsonDecode(credentialValue) as Map<String, dynamic>;
        _salt = credential['salt'] as String?;
        _passwordHash = credential['passwordHash'] as String?;
      }
      if (sessionValue != null) {
        _session = AuthSession.fromJson(
          jsonDecode(sessionValue) as Map<String, dynamic>,
        );
      }
    } catch (_) {
      _account = null;
      _salt = null;
      _passwordHash = null;
      _session = null;
    }
  }

  AuthSession _createSession(String userId) {
    final now = DateTime.now();
    return AuthSession(
      userId: userId,
      token:
          'mock_${sha256.convert(utf8.encode('$userId:${now.microsecondsSinceEpoch}'))}',
      createdAt: now,
      expiresAt: now.add(const Duration(days: 30)),
    );
  }

  String _hashPassword(String password, String salt) {
    List<int> value = utf8.encode('$salt:$password');
    for (var i = 0; i < 1200; i++) {
      value = sha256.convert(value).bytes;
    }
    return base64UrlEncode(value);
  }

  String _validateEmail(String value) {
    final email = value.trim().toLowerCase();
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      throw const AuthException('请输入有效邮箱');
    }
    return email;
  }

  String _validatePhone(String value) {
    final phone = value.replaceAll(RegExp(r'[\s-]'), '');
    if (!RegExp(r'^\+?[0-9]{7,15}$').hasMatch(phone)) {
      throw const AuthException('请输入有效手机号');
    }
    return phone;
  }

  void _validatePassword(String value) {
    if (value.length < 8) {
      throw const AuthException('密码至少需要 8 位');
    }
  }

  Future<void> _save() async {
    await Future.wait([_saveAccount(), _saveCredential(), _saveSession()]);
  }

  Future<void> _saveAccount() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      if (_account case final account?) {
        await storage.setString(_accountKey, jsonEncode(account.toJson()));
      }
    } catch (_) {
      // The in-memory demo account remains available.
    }
  }

  Future<void> _saveCredential() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setString(
        _credentialKey,
        jsonEncode({'salt': _salt, 'passwordHash': _passwordHash}),
      );
    } catch (_) {
      // The in-memory demo account remains available.
    }
  }

  Future<void> _saveSession() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      if (_session case final session?) {
        await storage.setString(_sessionKey, jsonEncode(session.toJson()));
      }
    } catch (_) {
      // The in-memory demo session remains available.
    }
  }
}
