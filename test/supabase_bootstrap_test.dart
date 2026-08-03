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
}
