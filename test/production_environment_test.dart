import 'package:fit_ai/config/production_environment.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('development environment allows local endpoints', () {
    const ProductionEnvironment(
      appEnvironment: 'development',
      apiBaseUrl: 'http://127.0.0.1:3000',
      authApiBaseUrl: '',
      analyticsApiBaseUrl: '',
      productCatalogUrl: '',
      affiliateChannelId: '',
    ).validate();
  });

  test('production requires all HTTPS service endpoints', () {
    expect(
      () => const ProductionEnvironment(
        appEnvironment: 'production',
        apiBaseUrl: 'http://api.example.com',
        authApiBaseUrl: 'https://api.example.com',
        analyticsApiBaseUrl: 'https://api.example.com',
        productCatalogUrl: 'https://commerce.example.com/products',
        affiliateChannelId: 'channel-1',
      ).validate(),
      throwsStateError,
    );
  });

  test('complete production configuration passes validation', () {
    const ProductionEnvironment(
      appEnvironment: 'production',
      apiBaseUrl: 'https://api.example.com',
      authApiBaseUrl: 'https://api.example.com',
      analyticsApiBaseUrl: 'https://api.example.com',
      productCatalogUrl: 'https://commerce.example.com/products',
      affiliateChannelId: 'channel-1',
    ).validate();
  });
}
