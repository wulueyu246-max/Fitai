import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:math';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../core/logging/app_logger.dart';
import '../models/outfit_analysis.dart';
import '../models/outfit_request.dart';

class AIServiceException implements Exception {
  const AIServiceException(
    this.message, {
    this.statusCode,
    this.requestId,
  });

  final String message;
  final int? statusCode;
  final String? requestId;

  @override
  String toString() => message;
}

class AIService {
  AIService({
    http.Client? client,
    AppConfig? config,
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _config = config ?? AppConfig.fromEnvironment();

  final http.Client _client;
  final bool _ownsClient;
  final AppConfig _config;

  Future<OutfitAnalysis> generateOutfit(OutfitRequest request) async {
    late final http.Response response;
    late final Uri endpoint;
    final totalStopwatch = Stopwatch()..start();
    final clientRequestId = _newRequestId();

    try {
      endpoint = _config.outfitEndpoint;
      developer.log(
        'POST $endpoint',
        name: 'shupi.ai_service.request',
      );
      response = await _client
          .post(
            endpoint,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json; charset=utf-8',
              'X-Defer-Products': 'true',
              'X-Request-Id': clientRequestId,
            },
            body: jsonEncode(request.toJson()),
          )
          .timeout(_config.aiTimeout);
    } on TimeoutException catch (error, stackTrace) {
      developer.log(
        '请求超时：${_config.apiBaseUrl}',
        name: 'shupi.ai_service.error',
        error: error,
        stackTrace: stackTrace,
      );
      throw const AIServiceException(
        '云端 AI 响应超时。免费服务首次唤醒可能较慢，请稍后重试',
      );
    } on http.ClientException catch (error, stackTrace) {
      developer.log(
        '无法连接服务器：${_config.apiBaseUrl}',
        name: 'shupi.ai_service.error',
        error: error,
        stackTrace: stackTrace,
      );
      throw const AIServiceException('无法连接服务器，请检查网络和服务地址');
    } on FormatException catch (error, stackTrace) {
      developer.log(
        'API_BASE_URL 无效：${_config.apiBaseUrl}',
        name: 'shupi.ai_service.error',
        error: error,
        stackTrace: stackTrace,
      );
      throw const AIServiceException('API 服务地址配置无效');
    } catch (error, stackTrace) {
      developer.log(
        '请求发送失败：${_config.apiBaseUrl}',
        name: 'shupi.ai_service.error',
        error: error,
        stackTrace: stackTrace,
      );
      throw const AIServiceException('请求发送失败，请稍后重试');
    }

    final serverRequestId = response.headers['x-request-id'];
    AppLogger.instance.info(
      'outfit_http_completed',
      metadata: {
        'clientRequestId': clientRequestId,
        'requestId': serverRequestId,
        'statusCode': response.statusCode,
        'totalDurationMs': totalStopwatch.elapsedMilliseconds,
        'serverTiming': response.headers['server-timing'] ?? '',
      },
    );

    dynamic decodedBody;

    try {
      decodedBody = jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      throw AIServiceException(
        '服务器返回了无法解析的数据',
        statusCode: response.statusCode,
        requestId: response.headers['x-request-id'],
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = _readServerError(decodedBody);
      throw AIServiceException(
        error.message,
        statusCode: response.statusCode,
        requestId: error.requestId ?? response.headers['x-request-id'],
      );
    }

    final payload = _extractAnalysisPayload(decodedBody);
    if (payload == null) {
      throw AIServiceException(
        '服务器返回的数据结构无效',
        statusCode: response.statusCode,
        requestId: response.headers['x-request-id'],
      );
    }

    try {
      final analysis = OutfitAnalysis.fromJson(payload).copyWith(
        requestId: serverRequestId ?? clientRequestId,
      );
      AppLogger.instance.info(
        'ai_gender_resolved',
        metadata: {
          'requestId': analysis.requestId,
          'aiGender': analysis.gender,
        },
      );
      return analysis;
    } on FormatException catch (error, stackTrace) {
      developer.log(
        '穿搭分析响应解析失败；顶层字段：${payload.keys.join(', ')}',
        name: 'shupi.ai_service',
        error: error,
        stackTrace: stackTrace,
      );
      throw AIServiceException(
        '服务器返回的穿搭分析不完整：${error.message}',
        statusCode: response.statusCode,
        requestId: response.headers['x-request-id'],
      );
    }
  }

  static String _newRequestId() {
    final random = Random.secure();
    String hex(int length) => List.generate(
          length,
          (_) => random.nextInt(16).toRadixString(16),
        ).join();
    return '${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}';
  }

  void close() {
    if (_ownsClient) {
      _client.close();
    }
  }

  static Map<String, dynamic>? _extractAnalysisPayload(dynamic decodedBody) {
    if (decodedBody is! Map<String, dynamic>) {
      return null;
    }

    for (final key in const ['data', 'result', 'analysis']) {
      final nested = decodedBody[key];
      if (nested is Map<String, dynamic>) {
        return nested;
      }
      if (nested is String) {
        try {
          final decoded = jsonDecode(nested);
          if (decoded is Map<String, dynamic>) {
            return decoded;
          }
        } on FormatException {
          // Continue with the canonical top-level payload below.
        }
      }
    }

    return decodedBody;
  }

  static ({String message, String? requestId}) _readServerError(
    dynamic decodedBody,
  ) {
    if (decodedBody is Map) {
      final error = decodedBody['error'];

      if (error is Map && error['message'] is String) {
        return (
          message: error['message'] as String,
          requestId: error['request_id'] as String?,
        );
      }
    }

    return (
      message: '服务器请求失败，请稍后重试',
      requestId: null,
    );
  }
}
