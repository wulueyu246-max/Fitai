import 'app_config.dart';

class ProductionEnvironment {
  const ProductionEnvironment({
    required this.appEnvironment,
    required this.apiBaseUrl,
    required this.authApiBaseUrl,
    required this.analyticsApiBaseUrl,
    required this.productCatalogUrl,
    required this.affiliateChannelId,
  });

  factory ProductionEnvironment.fromDartDefines() {
    final appConfig = AppConfig.fromEnvironment();
    const authApiBaseUrl = String.fromEnvironment('AUTH_API_BASE_URL');
    const analyticsApiBaseUrl =
        String.fromEnvironment('ANALYTICS_API_BASE_URL');
    const productCatalogUrl = String.fromEnvironment('PRODUCT_CATALOG_URL');
    return ProductionEnvironment(
      appEnvironment: String.fromEnvironment(
        'APP_ENV',
        defaultValue: 'development',
      ),
      apiBaseUrl: appConfig.apiBaseUrl,
      authApiBaseUrl:
          authApiBaseUrl.isEmpty ? appConfig.apiBaseUrl : authApiBaseUrl,
      analyticsApiBaseUrl: analyticsApiBaseUrl.isEmpty
          ? appConfig.apiBaseUrl
          : analyticsApiBaseUrl,
      productCatalogUrl: productCatalogUrl.isEmpty
          ? appConfig.endpoint('/products/recommend').toString()
          : productCatalogUrl,
      affiliateChannelId: const String.fromEnvironment(
        'AFFILIATE_CHANNEL_ID',
        defaultValue: 'fitai-commercial-test',
      ),
    );
  }

  final String appEnvironment;
  final String apiBaseUrl;
  final String authApiBaseUrl;
  final String analyticsApiBaseUrl;
  final String productCatalogUrl;
  final String affiliateChannelId;

  bool get isProduction => appEnvironment.toLowerCase() == 'production';

  void validate() {
    if (!isProduction) return;
    final values = {
      'API_BASE_URL': apiBaseUrl,
      'AUTH_API_BASE_URL': authApiBaseUrl,
      'ANALYTICS_API_BASE_URL': analyticsApiBaseUrl,
      'PRODUCT_CATALOG_URL': productCatalogUrl,
    };
    final missing = values.entries
        .where((entry) => entry.value.trim().isEmpty)
        .map((entry) => entry.key)
        .toList(growable: false);
    if (affiliateChannelId.trim().isEmpty) {
      missing.add('AFFILIATE_CHANNEL_ID');
    }
    if (missing.isNotEmpty) {
      throw StateError('生产环境缺少配置：${missing.join(', ')}');
    }
    for (final entry in values.entries) {
      final uri = Uri.tryParse(entry.value);
      if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
        throw StateError('${entry.key} 必须是有效的 HTTPS 地址');
      }
    }
  }
}
