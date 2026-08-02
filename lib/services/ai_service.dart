import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
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

    try {
      endpoint = _config.outfitEndpoint;
      developer.log(
        'POST $endpoint',
        name: 'shupi.ai_service.request',
      );
      response = await _client
          .post(
            endpoint,
            headers: const {
              'Accept': 'application/json',
              'Content-Type': 'application/json; charset=utf-8',
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
      throw const AIServiceException('AI 分析超时，请稍后重试');
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
      return OutfitAnalysis.fromJson(payload);
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
