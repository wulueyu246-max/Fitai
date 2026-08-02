import 'package:flutter/foundation.dart';

class AppConfig {
  const AppConfig({
    required this.apiBaseUrl,
    this.maxImageBytes = 5 * 1024 * 1024,
    this.aiTimeout = const Duration(seconds: 90),
  });

  factory AppConfig.fromEnvironment() {
    const timeoutMs = int.fromEnvironment(
      'AI_TIMEOUT_MS',
      defaultValue: 90000,
    );
    const configuredApiBaseUrl = String.fromEnvironment('API_BASE_URL');

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
        ? (!effectiveIsWeb && effectivePlatform == TargetPlatform.android
            ? 'http://10.0.2.2:3000'
            : 'http://127.0.0.1:3000')
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

  Uri get outfitEndpoint {
    final normalizedBaseUrl = apiBaseUrl.endsWith('/')
        ? apiBaseUrl.substring(0, apiBaseUrl.length - 1)
        : apiBaseUrl;
    final uri = Uri.tryParse('$normalizedBaseUrl/outfit');

    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw const FormatException('API_BASE_URL 配置无效');
    }

    return uri;
  }
}
