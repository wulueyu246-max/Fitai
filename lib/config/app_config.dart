import 'package:flutter/foundation.dart';

class AppConfig {
  static const defaultApiBaseUrl = 'https://fitai-jqtl.onrender.com';
  static const backendTimeout = Duration(seconds: 120);

  const AppConfig({
    required this.apiBaseUrl,
    this.maxImageBytes = 5 * 1024 * 1024,
    this.aiTimeout = backendTimeout,
  });

  factory AppConfig.fromEnvironment() {
    const timeoutMs = int.fromEnvironment(
      'AI_TIMEOUT_MS',
      defaultValue: 120000,
    );
    const configuredApiBaseUrl = String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: defaultApiBaseUrl,
    );

    return AppConfig(
      apiBaseUrl: resolveApiBaseUrl(configuredApiBaseUrl),
      maxImageBytes: const int.fromEnvironment(
        'MAX_IMAGE_BYTES',
        defaultValue: 5 * 1024 * 1024,
      ),
      aiTimeout: const Duration(milliseconds: timeoutMs),
    );
  }

  final String apiBaseUrl;
  final int maxImageBytes;
  final Duration aiTimeout;

  static String resolveApiBaseUrl(
    String configuredValue, {
    TargetPlatform? platform,
    bool? isWeb,
  }) {
    final effectivePlatform = platform ?? defaultTargetPlatform;
    final effectiveIsWeb = isWeb ?? kIsWeb;
    final configured = configuredValue.trim();
    final candidate = configured.isEmpty
        ? defaultApiBaseUrl
        : configured;

    if (effectiveIsWeb || effectivePlatform != TargetPlatform.android) {
      return candidate;
    }

    final uri = Uri.tryParse(candidate);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      return candidate;
    }

    const loopbackHosts = {'localhost', '127.0.0.1', '::1'};
    return loopbackHosts.contains(uri.host.toLowerCase())
        ? uri.replace(host: '10.0.2.2').toString()
        : candidate;
  }

  Uri endpoint(String path) {
    final normalizedBaseUrl = apiBaseUrl.endsWith('/')
        ? apiBaseUrl.substring(0, apiBaseUrl.length - 1)
        : apiBaseUrl;
    final normalizedPath = path.startsWith('/') ? path : '/$path';
    final uri = Uri.tryParse('$normalizedBaseUrl$normalizedPath');

    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw const FormatException('API_BASE_URL 配置无效');
    }

    return uri;
  }

  Uri get outfitEndpoint => endpoint('/outfit');
}
