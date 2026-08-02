import 'dart:convert';

import 'package:fit_ai/features/user/repositories/remote_auth_repository.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('remote auth handles register, profile update and logout', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      if (request.url.path == '/auth/register') {
        return http.Response(
          jsonEncode({
            'account': _accountJson(),
            'session': _sessionJson(),
          }),
          201,
          headers: {'content-type': 'application/json'},
        );
      }
      if (request.url.path == '/auth/profile') {
        final payload = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({
            'account': {
              ..._accountJson(),
              'gender': payload['gender'],
              'height': payload['height'],
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (request.url.path == '/auth/logout') {
        return http.Response('', 204);
      }
      return http.Response('{"error":{"message":"not found"}}', 404);
    });
    final repository = RemoteAuthRepository(
      baseUrl: Uri.parse('https://api.fitai.example'),
      client: client,
    );

    final registered = await repository.register(
      email: 'user@example.com',
      password: 'FitAI-test-2026',
      displayName: 'FitAI 用户',
    );
    expect(registered.account.userId, 'user-1');
    expect(registered.account.nickname, 'FitAI 用户');
    expect(registered.session.isMock, isFalse);

    final updated = await repository.updateProfile(
      registered.account.copyWith(gender: '女性', height: 168),
    );
    expect(updated.gender, '女性');
    expect(updated.height, 168);

    await repository.logout();
    expect(
      requests.where((request) => request.url.path == '/auth/logout'),
      hasLength(1),
    );
    expect(
      requests
          .firstWhere((request) => request.url.path == '/auth/profile')
          .headers['authorization'],
      'Bearer remote-token-12345678901234567890',
    );
  });

  test('remote auth surfaces backend validation messages', () async {
    final repository = RemoteAuthRepository(
      baseUrl: Uri.parse('https://api.fitai.example'),
      client: MockClient(
        (_) async => http.Response(
          '{"error":{"message":"该邮箱已经注册，请直接登录"}}',
          409,
          headers: {'content-type': 'application/json'},
        ),
      ),
    );

    expect(
      () => repository.register(
        email: 'user@example.com',
        password: 'FitAI-test-2026',
        displayName: 'FitAI 用户',
      ),
      throwsA(
        isA<Exception>().having(
          (error) => error.toString(),
          'message',
          contains('该邮箱已经注册'),
        ),
      ),
    );
  });

  test('remote auth deletes the server account and clears the session',
      () async {
    final requests = <http.Request>[];
    final repository = RemoteAuthRepository(
      baseUrl: Uri.parse('https://api.shupi.example'),
      client: MockClient((request) async {
        requests.add(request);
        if (request.url.path == '/auth/register') {
          return http.Response.bytes(
            utf8.encode(jsonEncode({
              'account': _accountJson(),
              'session': _sessionJson(),
            })),
            201,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        if (request.url.path == '/auth/account' && request.method == 'DELETE') {
          return http.Response('{"deleted":true}', 200);
        }
        return http.Response('{}', 404);
      }),
    );

    await repository.register(
      email: 'delete@example.com',
      password: 'Shupi-test-2026',
      displayName: 'Delete user',
    );
    await repository.deleteAccount();

    final deletion = requests.singleWhere(
      (request) => request.url.path == '/auth/account',
    );
    expect(deletion.method, 'DELETE');
    expect(
      deletion.headers['authorization'],
      'Bearer remote-token-12345678901234567890',
    );
    expect(await repository.restoreSession(), isNull);
  });
}

Map<String, dynamic> _accountJson() {
  return {
    'userId': 'user-1',
    'email': 'user@example.com',
    'nickname': 'FitAI 用户',
    'avatar': null,
    'gender': '未设置',
    'height': 173,
    'weight': 60,
    'age': 25,
    'bodyType': '匀称体型',
    'stylePreference': ['极简', '通勤'],
    'budgetPreference': {'min': 100, 'max': 1200},
    'favoriteBrands': ['UNIQLO'],
    'createdAt': '2026-07-30T00:00:00.000Z',
  };
}

Map<String, dynamic> _sessionJson() {
  return {
    'userId': 'user-1',
    'token': 'remote-token-12345678901234567890',
    'createdAt': '2026-07-30T00:00:00.000Z',
    'expiresAt': '2099-07-30T00:00:00.000Z',
    'isMock': false,
  };
}
