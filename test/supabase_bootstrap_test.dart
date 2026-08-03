import 'dart:async';

import 'package:fit_ai/services/supabase_bootstrap.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Supabase Flutter stays optional without public configuration',
      () async {
    const config = SupabaseBootstrapConfig(url: '', anonKey: '');

    expect(config.isConfigured, isFalse);
    expect(await SupabaseBootstrap.initialize(config: config), isFalse);
  });

  test('Supabase Flutter accepts only HTTPS project URLs', () {
    expect(
      const SupabaseBootstrapConfig(
        url: 'http://project.supabase.co',
        anonKey: 'public-anon-key',
      ).isConfigured,
      isFalse,
    );
    expect(
      const SupabaseBootstrapConfig(
        url: 'https://project.supabase.co',
        anonKey: 'public-anon-key',
      ).isConfigured,
      isTrue,
    );
  });

  test('Supabase Flutter initialization times out without blocking startup',
      () async {
    final pending = Completer<void>();
    const config = SupabaseBootstrapConfig(
      url: 'https://project.supabase.co',
      anonKey: 'public-anon-key',
    );

    final initialized = await SupabaseBootstrap.initialize(
      config: config,
      initializer: (_) => pending.future,
      timeout: const Duration(milliseconds: 1),
    );

    expect(initialized, isFalse);
  });
}
