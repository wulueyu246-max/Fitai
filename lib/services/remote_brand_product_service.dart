import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../models/product.dart';
import 'brand_product_service.dart';

/// Remote product source for a brand/affiliate catalog.
///
/// The backend owns signed affiliate URLs. FitAI only forwards the configured
/// channel ID and never rewrites a signed purchase URL on the client.
class RemoteBrandProductService implements BrandProductService {
  RemoteBrandProductService({
    required this.catalogEndpoint,
    http.Client? client,
    this.affiliateChannelId = const String.fromEnvironment(
      'AFFILIATE_CHANNEL_ID',
      defaultValue: 'fitai-commercial-test',
    ),
    this.timeout = AppConfig.backendTimeout,
  }) : _client = client ?? http.Client();

  final Uri catalogEndpoint;
  final String affiliateChannelId;
  final Duration timeout;
  final http.Client _client;

  @override
  Future<List<Product>> fetchProducts({String? brand}) async {
    final query = <String, String>{
      ...catalogEndpoint.queryParameters,
      'affiliateChannelId': affiliateChannelId,
      if (brand != null && brand.trim().isNotEmpty) 'brand': brand.trim(),
    };
    final response = await _client
        .get(
          catalogEndpoint.replace(queryParameters: query),
          headers: _headers,
        )
        .timeout(timeout);
    final payload = _decode(response);
    final values = payload is List<dynamic>
        ? payload
        : payload is Map<String, dynamic>
            ? payload['products'] as List<dynamic>? ?? const []
            : const [];
    return List<Product>.unmodifiable(
      values.whereType<Map<String, dynamic>>().map(_parseProduct),
    );
  }

  @override
  Future<Product?> getProductBySku(String sku) async {
    final normalizedSku = sku.trim();
    if (normalizedSku.isEmpty) {
      return null;
    }
    final basePath = catalogEndpoint.path.endsWith('/')
        ? catalogEndpoint.path
        : '${catalogEndpoint.path}/';
    final endpoint = catalogEndpoint.replace(
      path: '$basePath${Uri.encodeComponent(normalizedSku)}',
      queryParameters: {
        ...catalogEndpoint.queryParameters,
        'affiliateChannelId': affiliateChannelId,
      },
    );
    final response =
        await _client.get(endpoint, headers: _headers).timeout(timeout);
    if (response.statusCode == 404) {
      return null;
    }
    final payload = _decode(response);
    final productJson = payload is Map<String, dynamic> &&
            payload['product'] is Map<String, dynamic>
        ? payload['product'] as Map<String, dynamic>
        : payload;
    return productJson is Map<String, dynamic>
        ? _parseProduct(productJson)
        : null;
  }

  @override
  Future<int> getStock(String sku) async {
    return (await getProductBySku(sku))?.stock ?? 0;
  }

  @override
  Future<String> getCurrentPrice(String sku) async {
    return (await getProductBySku(sku))?.price ?? '';
  }

  @override
  Future<Uri?> getPurchaseUri(String sku) async {
    final url = (await getProductBySku(sku))?.purchaseUrl ?? '';
    if (url.isEmpty) return null;
    final uri = Uri.tryParse(url);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
      throw const ProductSourceException('商品购买链接必须使用有效的 HTTPS 地址');
    }
    return uri;
  }

  Map<String, String> get _headers => {
        'Accept': 'application/json',
        'X-FitAI-Affiliate-Channel': affiliateChannelId,
        'X-Shupi-Affiliate-Channel': affiliateChannelId,
      };

  Product _parseProduct(Map<String, dynamic> json) {
    final product = Product.fromJson(json);
    final purchaseUri = Uri.tryParse(product.purchaseUrl);
    if (product.purchaseUrl.isNotEmpty &&
        (purchaseUri == null ||
            purchaseUri.scheme != 'https' ||
            purchaseUri.host.isEmpty)) {
      throw const ProductSourceException('商品源返回了无效的 HTTPS 购买链接');
    }
    final hasChannel = json.containsKey('affiliateChannelId') ||
        json.containsKey('affiliate_channel_id') ||
        json.containsKey('channelId');
    final hasProvider = json.containsKey('sourceProvider') ||
        json.containsKey('source_provider') ||
        json.containsKey('provider');
    return product.copyWith(
      affiliateChannelId:
          hasChannel ? product.affiliateChannelId : affiliateChannelId,
      sourceProvider:
          hasProvider ? product.sourceProvider : 'remote-affiliate-catalog',
    );
  }

  Object? _decode(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ProductSourceException(
        '商品源请求失败（HTTP ${response.statusCode}）',
      );
    }
    try {
      return jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      throw const ProductSourceException('商品源返回了无效数据');
    }
  }
}

class ProductSourceException implements Exception {
  const ProductSourceException(this.message);

  final String message;

  @override
  String toString() => message;
}
