import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../models/auth_session.dart';
import '../models/user_account.dart';
import 'auth_repository.dart';

class RemoteAuthRepository
    implements
        AuthRepository,
        PhoneAuthRepository,
        SocialAuthRepository,
        AccountDeletionRepository {
  RemoteAuthRepository({
    required this.baseUrl,
    http.Client? client,
    SharedPreferencesAsync? storage,
    this.timeout = const Duration(seconds: 12),
  })  : _client = client ?? http.Client(),
        _storage = storage;

  static const _accountKey = 'fitai.remote_auth.account.v1';
  static const _sessionKey = 'fitai.remote_auth.session.v1';

  final Uri baseUrl;
  final http.Client _client;
  final Duration timeout;
  SharedPreferencesAsync? _storage;
  UserAccount? _account;
  AuthSession? _session;

  @override
  Future<AuthResult> register({
    required String email,
    required String password,
    required String displayName,
  }) {
    return _authenticate(
      '/auth/register',
      {
        'email': email.trim(),
        'password': password,
        'nickname': displayName.trim(),
      },
    );
  }

  @override
  Future<AuthResult> login({
    required String email,
    required String password,
  }) {
    return _authenticate(
      '/auth/login',
      {
        'email': email.trim(),
        'password': password,
      },
    );
  }

  @override
  Future<PhoneCodeChallenge> requestPhoneCode(String phone) async {
    try {
      final response = await _client
          .post(
            _uri('/auth/phone/code'),
            headers: _headers(),
            body: jsonEncode({'phone': phone.trim()}),
          )
          .timeout(timeout);
      final body = _requireSuccess(response);
      return PhoneCodeChallenge(
        expiresAt: DateTime.tryParse(body['expiresAt']?.toString() ?? '') ??
            DateTime.now().add(const Duration(minutes: 5)),
        debugCode: body['debugCode']?.toString(),
      );
    } on TimeoutException {
      throw const AuthException('验证码服务响应超时');
    } on http.ClientException {
      throw const AuthException('无法连接验证码服务');
    }
  }

  @override
  Future<AuthResult> loginWithPhoneCode({
    required String phone,
    required String code,
  }) {
    return _authenticate('/auth/phone/login', {
      'phone': phone.trim(),
      'code': code.trim(),
    });
  }

  @override
  Future<AuthResult> loginWithSocial(SocialAuthProvider provider) {
    throw const AuthException('微信与 Apple 登录接口已预留，暂未开放');
  }

  @override
  Future<AuthResult?> restoreSession() async {
    await _loadCached();
    final account = _account;
    final session = _session;
    if (account == null || session == null || session.isExpired) {
      await _clear();
      return null;
    }

    try {
      final response = await _client
          .get(
            _uri('/auth/me'),
            headers: _headers(token: session.token),
          )
          .timeout(timeout);
      if (response.statusCode == 401) {
        await _clear();
        return null;
      }
      final body = _requireSuccess(response);
      final refreshed = UserAccount.fromJson(
        body['account'] as Map<String, dynamic>,
      );
      _account = refreshed;
      await _save();
      return AuthResult(account: refreshed, session: session);
    } on TimeoutException {
      return AuthResult(account: account, session: session);
    } on http.ClientException {
      return AuthResult(account: account, session: session);
    }
  }

  @override
  Future<UserAccount> updateProfile(UserAccount account) async {
    final session = _session;
    if (session == null || session.isExpired) {
      throw const AuthException('登录状态已失效，请重新登录');
    }
    try {
      final response = await _client
          .patch(
            _uri('/auth/profile'),
            headers: _headers(token: session.token),
            body: jsonEncode(_profilePayload(account)),
          )
          .timeout(timeout);
      final body = _requireSuccess(response);
      final updated = UserAccount.fromJson(
        body['account'] as Map<String, dynamic>,
      );
      _account = updated;
      await _save();
      return updated;
    } on TimeoutException {
      throw const AuthException('资料保存超时，请稍后重试');
    } on http.ClientException {
      throw const AuthException('无法连接用户服务，请检查 Node 后端');
    }
  }

  @override
  Future<void> logout() async {
    final session = _session;
    try {
      if (session != null) {
        await _client
            .post(
              _uri('/auth/logout'),
              headers: _headers(token: session.token),
            )
            .timeout(timeout);
      }
    } catch (_) {
      // Local credentials are still removed when the server is unavailable.
    } finally {
      await _clear();
    }
  }

  @override
  Future<void> deleteAccount() async {
    final session = _session;
    if (session == null || session.isExpired) {
      throw const AuthException('登录状态已失效，请重新登录');
    }
    try {
      final response = await _client
          .delete(
            _uri('/auth/account'),
            headers: _headers(token: session.token),
          )
          .timeout(timeout);
      _requireSuccess(response);
      await _clear();
    } on TimeoutException {
      throw const AuthException('账号注销请求超时，请稍后重试');
    } on http.ClientException {
      throw const AuthException('无法连接账号服务，请检查网络');
    }
  }

  Future<AuthResult> _authenticate(
    String path,
    Map<String, dynamic> payload,
  ) async {
    try {
      final response = await _client
          .post(
            _uri(path),
            headers: _headers(),
            body: jsonEncode(payload),
          )
          .timeout(timeout);
      final body = _requireSuccess(response);
      final result = AuthResult(
        account: UserAccount.fromJson(
          body['account'] as Map<String, dynamic>,
        ),
        session: AuthSession.fromJson(
          body['session'] as Map<String, dynamic>,
        ),
      );
      _account = result.account;
      _session = result.session;
      await _save();
      return result;
    } on TimeoutException {
      throw const AuthException('登录服务响应超时，请稍后重试');
    } on http.ClientException {
      throw const AuthException('无法连接登录服务，请检查 Node 后端');
    }
  }

  Map<String, dynamic> _requireSuccess(http.Response response) {
    Map<String, dynamic> body;
    try {
      final decoded = jsonDecode(response.body);
      body = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    } catch (_) {
      body = <String, dynamic>{};
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = body['error'];
      final message =
          error is Map<String, dynamic> ? error['message']?.toString() : null;
      throw AuthException(message ?? '用户服务暂时不可用');
    }
    return body;
  }

  Uri _uri(String path) {
    final normalizedBase = baseUrl.toString().replaceFirst(RegExp(r'/$'), '');
    return Uri.parse('$normalizedBase$path');
  }

  Map<String, String> _headers({String? token}) {
    return {
      'content-type': 'application/json',
      if (token != null) 'authorization': 'Bearer $token',
    };
  }

  Map<String, dynamic> _profilePayload(UserAccount account) {
    return {
      'avatar': account.avatar,
      'nickname': account.nickname,
      'gender': account.gender,
      'height': account.height,
      'weight': account.weight,
      'age': account.age,
      'bodyType': account.bodyType,
      'stylePreference': account.stylePreference,
      'budgetPreference': account.budgetPreference,
      'favoriteBrands': account.favoriteBrands,
    };
  }

  Future<void> _loadCached() async {
    if (_account != null || _session != null) {
      return;
    }
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final accountValue = await storage.getString(_accountKey);
      final sessionValue = await storage.getString(_sessionKey);
      if (accountValue != null && sessionValue != null) {
        _account = UserAccount.fromJson(
          jsonDecode(accountValue) as Map<String, dynamic>,
        );
        _session = AuthSession.fromJson(
          jsonDecode(sessionValue) as Map<String, dynamic>,
        );
      }
    } catch (_) {
      _account = null;
      _session = null;
    }
  }

  Future<void> _save() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final account = _account;
      final session = _session;
      if (account != null && session != null) {
        await Future.wait([
          storage.setString(_accountKey, jsonEncode(account.toJson())),
          storage.setString(_sessionKey, jsonEncode(session.toJson())),
        ]);
      }
    } catch (_) {
      // A persistence failure does not invalidate the active remote session.
    }
  }

  Future<void> _clear() async {
    _account = null;
    _session = null;
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await Future.wait([
        storage.remove(_accountKey),
        storage.remove(_sessionKey),
      ]);
    } catch (_) {
      // In-memory logout is still complete.
    }
  }
}
