import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../features/user/services/user_session_controller.dart';

abstract interface class PhotoStorageService {
  Future<void> storePhotos(Map<String, String> images);

  factory PhotoStorageService.fromEnvironment(
    UserSessionController sessionController,
  ) {
    const baseValue = String.fromEnvironment('AUTH_API_BASE_URL');
    final baseUrl = Uri.tryParse(baseValue);
    return baseUrl != null && baseUrl.hasScheme && baseUrl.host.isNotEmpty
        ? RemotePhotoStorageService(
            baseUrl: baseUrl,
            sessionController: sessionController,
          )
        : const NoopPhotoStorageService();
  }
}

class NoopPhotoStorageService implements PhotoStorageService {
  const NoopPhotoStorageService();

  @override
  Future<void> storePhotos(Map<String, String> images) async {}
}

class RemotePhotoStorageService implements PhotoStorageService {
  RemotePhotoStorageService({
    required this.baseUrl,
    required this.sessionController,
    http.Client? client,
    this.timeout = AppConfig.backendTimeout,
  }) : _client = client ?? http.Client();

  final Uri baseUrl;
  final UserSessionController sessionController;
  final http.Client _client;
  final Duration timeout;

  @override
  Future<void> storePhotos(Map<String, String> images) async {
    final session = sessionController.session;
    if (session == null || session.isExpired || images.isEmpty) return;
    final endpoint = _uri('/user/photos');
    for (final entry in images.entries) {
      final response = await _client
          .post(
            endpoint,
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer ${session.token}',
            },
            body: jsonEncode({
              'kind': entry.key,
              'image_data': entry.value,
            }),
          )
          .timeout(timeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const PhotoStorageException('照片云端保存失败，请稍后重试');
      }
    }
  }

  Uri _uri(String path) {
    final normalized = baseUrl.toString().replaceFirst(RegExp(r'/$'), '');
    return Uri.parse('$normalized$path');
  }
}

class PhotoStorageException implements Exception {
  const PhotoStorageException(this.message);
  final String message;
  @override
  String toString() => message;
}
