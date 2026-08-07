import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../core/logging/app_logger.dart';
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
    this.timeout = const Duration(seconds: 75),
    bool? enforceProductionSafety,
  })  : enforceProductionSafety = enforceProductionSafety ??
            (kReleaseMode &&
                !const bool.fromEnvironment('MOCK_MODE', defaultValue: false)),
        _client = client ?? http.Client();

  final Uri catalogEndpoint;
  final String affiliateChannelId;
  final Duration timeout;
  final bool enforceProductionSafety;
  final http.Client _client;

  @override
  Future<List<Product>> fetchProducts({
    String? brand,
    Map<String, dynamic>? recommendationContext,
  }) async {
    final query = <String, String>{
      ...catalogEndpoint.queryParameters,
      'affiliateChannelId': affiliateChannelId,
      if (brand != null && brand.trim().isNotEmpty) 'brand': brand.trim(),
    };
    final response = recommendationContext == null
        ? await _get(catalogEndpoint.replace(queryParameters: query))
        : await _post(
            catalogEndpoint.replace(
              queryParameters: catalogEndpoint.queryParameters,
            ),
            {
              ...recommendationContext,
              'affiliateChannelId': affiliateChannelId,
              if (brand != null && brand.trim().isNotEmpty)
                'brand': brand.trim(),
            },
          );
    final payload = _decode(response);
    final values = _extractProducts(payload);
    _debugProductsLength(values.length);
    final parsedProducts = List<Product>.unmodifiable(
      values.whereType<Map<String, dynamic>>().map(_parseProduct),
    );
    if (values.isNotEmpty && parsedProducts.isEmpty) {
      throw const ProductSourceException('商品源返回的 products 字段格式无效');
    }
    final explicitSearchKeyword =
        recommendationContext?['explicit_user_search'] == true
            ? (recommendationContext?['user_search_keyword']?.toString() ?? '')
            : '';
    final qualitySafeProducts = parsedProducts.where((product) {
      final block = lookProductQualityBlock(
        product,
        explicitSearchKeyword: explicitSearchKeyword,
      );
      if (block == null) return true;
      AppLogger.instance.warning(
        'low_value_product_filtered',
        metadata: {
          'productId': product.id,
          'blocked_category': block.blockedCategory,
          'blocked_keyword': block.blockedKeyword,
        },
      );
      return false;
    }).toList(growable: false);
    if (!enforceProductionSafety) {
      return List<Product>.unmodifiable(qualitySafeProducts);
    }

    final expectedRequestId =
        recommendationContext?['request_id']?.toString().trim();
    final products = qualitySafeProducts.where((product) {
      final source = product.sourceProvider.trim().toLowerCase();
      final matchesRequest = expectedRequestId == null ||
          expectedRequestId.isEmpty ||
          product.requestId == expectedRequestId;
      return !product.isMock && source == 'taobao' && matchesRequest;
    }).toList(growable: false);
    if (products.length != parsedProducts.length) {
      AppLogger.instance.warning(
        'unsafe_product_response_filtered',
        metadata: {
          'receivedCount': parsedProducts.length,
          'acceptedCount': products.length,
          'requestId': expectedRequestId,
        },
      );
    }
    if (products.isEmpty) {
      throw const ProductSourceException('商品暂时加载失败，请重新生成');
    }
    return List<Product>.unmodifiable(products);
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
    final response = await _get(endpoint);
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

  Map<String, String> get _headers => const {
        'Accept': 'application/json',
      };

  Future<http.Response> _get(Uri endpoint) async {
    return _send(
      method: 'GET',
      endpoint: endpoint,
      send: () => _client.get(endpoint, headers: _headers),
    );
  }

  Future<http.Response> _post(
    Uri endpoint,
    Map<String, dynamic> body,
  ) async {
    final requestId = body['request_id']?.toString().trim() ?? '';
    return _send(
      method: 'POST',
      endpoint: endpoint,
      send: () => _client.post(
        endpoint,
        headers: {
          ..._headers,
          'Content-Type': 'application/json',
          if (requestId.isNotEmpty) 'X-Request-Id': requestId,
        },
        body: jsonEncode(body),
      ),
    );
  }

  Future<http.Response> _send({
    required String method,
    required Uri endpoint,
    required Future<http.Response> Function() send,
  }) async {
    final stopwatch = Stopwatch()..start();
    Object? lastError;
    for (var attempt = 1; attempt <= 2; attempt += 1) {
      try {
        final response = await send().timeout(timeout);
        AppLogger.instance.info(
          'product_http_completed',
          metadata: {
            'method': method,
            'url': endpoint.replace(queryParameters: const {}).toString(),
            'statusCode': response.statusCode,
            'durationMs': stopwatch.elapsedMilliseconds,
            'attempt': attempt,
            'requestId': response.headers['x-request-id'],
            'serverTiming': response.headers['server-timing'] ?? '',
          },
        );
        return response;
      } on TimeoutException catch (error) {
        lastError = error;
      } on http.ClientException catch (error) {
        lastError = error;
      }
    }
    AppLogger.instance.error(
      'product_http_failed',
      error: lastError,
      metadata: {
        'durationMs': stopwatch.elapsedMilliseconds,
        'attempts': 2,
      },
    );
    throw ProductSourceException(
      lastError is TimeoutException ? '商品匹配响应超时，请重试' : '商品服务暂时无法连接，请重试',
    );
  }

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
        json.containsKey('source') ||
        json.containsKey('provider') ||
        json.containsKey('platform');
    return product.copyWith(
      affiliateChannelId:
          hasChannel ? product.affiliateChannelId : affiliateChannelId,
      sourceProvider:
          hasProvider ? product.sourceProvider : 'remote-affiliate-catalog',
    );
  }

  Object? _decode(http.Response response) {
    final responseBody = utf8.decode(response.bodyBytes);
    _debugResponse(response.statusCode);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ProductSourceException(
        '商品源请求失败（HTTP ${response.statusCode}）',
      );
    }
    try {
      final decoded = jsonDecode(responseBody);
      return decoded;
    } catch (_) {
      throw const ProductSourceException('商品源返回了无效数据');
    }
  }

  List<dynamic> _extractProducts(Object? payload) {
    if (payload is List<dynamic>) {
      return payload;
    }
    if (payload is! Map<String, dynamic>) {
      return const [];
    }

    final categorySlots = payload['categorySlots'] ?? payload['category_slots'];
    if (categorySlots is Map<String, dynamic>) {
      final products = <dynamic>[];
      final ids = <String>{};
      for (final slot in ProductCategory.values) {
        final values = categorySlots[slot];
        if (values is! List<dynamic>) continue;
        for (final value in values) {
          if (value is! Map<String, dynamic>) continue;
          final product = <String, dynamic>{...value, 'category': slot};
          final id = product['product_id']?.toString() ??
              product['id']?.toString() ??
              '';
          final lookId = product['look_id']?.toString() ??
              product['lookId']?.toString() ??
              '';
          final scopedId = '$lookId:$id';
          if (id.isEmpty || ids.add(scopedId)) products.add(product);
        }
      }
      if (products.isNotEmpty) return products;
    }

    final directProducts = payload['products'];
    if (directProducts is List<dynamic>) {
      return directProducts;
    }
    final directItems = payload['items'];
    if (directItems is List<dynamic>) {
      return directItems;
    }
    final data = payload['data'];
    if (data is Map<String, dynamic>) {
      final nestedProducts = data['products'];
      if (nestedProducts is List<dynamic>) {
        return nestedProducts;
      }
      final nestedItems = data['items'];
      if (nestedItems is List<dynamic>) {
        return nestedItems;
      }
    }
    return const [];
  }

  void _debugResponse(int statusCode) {
    if (!kDebugMode) return;
    debugPrint('[Shupi][product_response] statusCode=$statusCode');
  }

  void _debugProductsLength(int length) {
    if (!kDebugMode) return;
    debugPrint('[Shupi][product_response] products.length=$length');
  }
}

class ProductSourceException implements Exception {
  const ProductSourceException(this.message);

  final String message;

  @override
  String toString() => message;
}
