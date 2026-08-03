import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/logging/app_logger.dart';

typedef SupabaseInitializer = Future<void> Function(
  SupabaseBootstrapConfig config,
);

class SupabaseBootstrapConfig {
  const SupabaseBootstrapConfig({required this.url, required this.anonKey});

  factory SupabaseBootstrapConfig.fromEnvironment() {
    return const SupabaseBootstrapConfig(
      url: String.fromEnvironment('SUPABASE_URL'),
      anonKey: String.fromEnvironment('SUPABASE_ANON_KEY'),
    );
  }

  final String url;
  final String anonKey;

  bool get isConfigured {
    final uri = Uri.tryParse(url);
    return anonKey.isNotEmpty &&
        uri != null &&
        uri.scheme == 'https' &&
        uri.host.isNotEmpty;
  }
}

class SupabaseBootstrap {
  SupabaseBootstrap._();

  static bool _initialized = false;

  static Future<bool> initialize({
    SupabaseBootstrapConfig? config,
    SupabaseInitializer? initializer,
    Duration timeout = const Duration(seconds: 10),
  }) async {
    if (_initialized) return true;
    final current = config ?? SupabaseBootstrapConfig.fromEnvironment();
    if (!current.isConfigured) {
      AppLogger.instance.warning('supabase_flutter_not_configured');
      return false;
    }
    try {
      await (initializer ?? _initializeClient)(current).timeout(timeout);
      _initialized = true;
      AppLogger.instance.info('supabase_flutter_initialized');
      return true;
    } catch (error, stackTrace) {
      AppLogger.instance.error(
        'supabase_flutter_initialization_failed',
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  static Future<void> _initializeClient(SupabaseBootstrapConfig config) async {
    await Supabase.initialize(
      url: config.url,
      publishableKey: config.anonKey,
    );
  }
}
