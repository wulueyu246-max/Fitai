import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../features/user/services/user_session_controller.dart';
import '../models/wardrobe_snapshot.dart';

abstract interface class WardrobeSyncService {
  Future<WardrobeSnapshot?> pull();

  Future<void> push(WardrobeSnapshot snapshot);
}

class NoopWardrobeSyncService implements WardrobeSyncService {
  const NoopWardrobeSyncService();

  @override
  Future<WardrobeSnapshot?> pull() async => null;

  @override
  Future<void> push(WardrobeSnapshot snapshot) async {}
}

class RemoteWardrobeSyncService implements WardrobeSyncService {
  RemoteWardrobeSyncService({
    required this.baseUrl,
    required this.sessionController,
    http.Client? client,
    this.timeout = const Duration(seconds: 12),
  }) : _client = client ?? http.Client();

  final Uri baseUrl;
  final UserSessionController sessionController;
  final http.Client _client;
  final Duration timeout;

  @override
  Future<WardrobeSnapshot?> pull() async {
    final token = sessionController.session?.token;
    if (token == null) {
      return null;
    }
    final response = await _client
        .get(_uri('/user/wardrobe'), headers: _headers(token))
        .timeout(timeout);
    final body = _decode(response);
    final wardrobe = body['wardrobe'];
    return wardrobe is Map<String, dynamic>
        ? WardrobeSnapshot.fromJson(wardrobe)
        : WardrobeSnapshot.empty();
  }

  @override
  Future<void> push(WardrobeSnapshot snapshot) async {
    final token = sessionController.session?.token;
    if (token == null) {
      return;
    }
    final response = await _client
        .put(
          _uri('/user/wardrobe'),
          headers: _headers(token),
          body: jsonEncode(snapshot.toJson()),
        )
        .timeout(timeout);
    _decode(response);
  }

  Uri _uri(String path) {
    final normalized = baseUrl.path.endsWith('/')
        ? baseUrl.path.substring(0, baseUrl.path.length - 1)
        : baseUrl.path;
    return baseUrl.replace(path: '$normalized$path', queryParameters: const {});
  }

  Map<String, String> _headers(String token) => {
        'accept': 'application/json',
        'content-type': 'application/json',
        'authorization': 'Bearer $token',
      };

  Map<String, dynamic> _decode(http.Response response) {
    Map<String, dynamic> body;
    try {
      final value = jsonDecode(utf8.decode(response.bodyBytes));
      body = value is Map<String, dynamic> ? value : <String, dynamic>{};
    } catch (_) {
      body = <String, dynamic>{};
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = body['error'];
      final message =
          error is Map<String, dynamic> ? error['message'] as String? : null;
      throw WardrobeSyncException(message ?? '云端衣柜同步失败');
    }
    return body;
  }
}

class WardrobeSyncException implements Exception {
  const WardrobeSyncException(this.message);

  final String message;

  @override
  String toString() => message;
}
