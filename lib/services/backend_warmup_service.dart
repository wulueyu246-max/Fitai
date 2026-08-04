import 'dart:async';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../core/logging/app_logger.dart';

class BackendWarmupResult {
  const BackendWarmupResult({
    required this.durationMs,
    required this.isReady,
    this.statusCode,
  });

  final int durationMs;
  final bool isReady;
  final int? statusCode;
}

class BackendWarmupService {
  BackendWarmupService({
    http.Client? client,
    AppConfig? config,
    this.timeout = const Duration(seconds: 20),
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _config = config ?? AppConfig.fromEnvironment();

  final http.Client _client;
  final bool _ownsClient;
  final AppConfig _config;
  final Duration timeout;

  Future<BackendWarmupResult> wake() async {
    final stopwatch = Stopwatch()..start();
    int? statusCode;
    try {
      final response =
          await _client.get(_config.endpoint('/health'), headers: const {
        'Accept': 'application/json',
      }).timeout(timeout);
      statusCode = response.statusCode;
      return BackendWarmupResult(
        durationMs: stopwatch.elapsedMilliseconds,
        statusCode: statusCode,
        isReady: statusCode >= 200 && statusCode < 300,
      );
    } catch (error, stackTrace) {
      AppLogger.instance.warning(
        'backend_warmup_failed',
        metadata: {
          'durationMs': stopwatch.elapsedMilliseconds,
          'statusCode': statusCode,
          'errorType': error.runtimeType.toString(),
          'hasStackTrace': stackTrace.toString().isNotEmpty,
        },
      );
      return BackendWarmupResult(
        durationMs: stopwatch.elapsedMilliseconds,
        statusCode: statusCode,
        isReady: false,
      );
    } finally {
      stopwatch.stop();
    }
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
