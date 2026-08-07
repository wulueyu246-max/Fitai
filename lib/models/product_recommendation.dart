import 'product.dart';

class ProductRecommendation {
  const ProductRecommendation({
    required this.productId,
    required this.category,
    required this.keyword,
    required this.title,
    required this.brand,
    required this.color,
    required this.size,
    required this.imageUrl,
    required this.price,
    required this.platform,
    required this.commissionRate,
    required this.detailUrl,
    required this.affiliateUrl,
    required this.stockStatus,
    this.originalPrice,
    this.couponAmount = 0,
    this.shopName = '',
    this.sales,
    this.recommendationReason = '',
    this.matchExplanation = '',
    this.isMock = false,
    this.tags = const [],
  });

  factory ProductRecommendation.fromJson(Map<String, dynamic> json) {
    final price = _readNumber(json, 'price');
    final category = ProductCategory.normalize(_readString(json, 'category'));
    final rawCommission = _readOptionalNumber(json, 'commission');
    final commissionRate = json.containsKey('commission_rate')
        ? _readNumber(json, 'commission_rate')
        : _readOptionalNumber(json, 'commissionRate') ??
            _readOptionalNumber(json, 'commission_rate') ??
            (rawCommission == null || price <= 0
                ? 0
                : rawCommission > 1
                    ? rawCommission / price
                    : rawCommission);

    return ProductRecommendation(
      productId:
          _readAliasedString(json, const ['product_id', 'productId', 'id']),
      category: category,
      keyword: _readOptionalString(json, 'keyword', fallback: category),
      title: _readString(json, 'title'),
      brand: _readOptionalString(json, 'brand', fallback: '精选商品'),
      color: _readOptionalString(json, 'color', fallback: '以商品页为准'),
      size: _readOptionalString(json, 'size', fallback: '以商品页为准'),
      imageUrl: normalizeProductImageUrl(
        _readAliasedString(
          json,
          const ['image_url', 'imageUrl', 'image'],
          fallback: '',
        ),
      ),
      price: price,
      platform: _readString(json, 'platform'),
      commissionRate: commissionRate.clamp(0, 1).toDouble(),
      detailUrl: _readAliasedString(
        json,
        const ['detail_url', 'detailUrl', 'purchase_url', 'purchaseUrl'],
        fallback: '',
      ),
      affiliateUrl: _readAliasedString(
        json,
        const [
          'affiliate_url',
          'affiliateUrl',
          'purchase_url',
          'purchaseUrl',
        ],
        fallback: '',
      ),
      stockStatus: _readOptionalString(
        json,
        'stock_status',
        fallback: _readOptionalString(
          json,
          'stockStatus',
          fallback: 'in_stock',
        ),
      ),
      originalPrice: _readOptionalNumber(json, 'original_price') ??
          _readOptionalNumber(json, 'originalPrice'),
      couponAmount: _readOptionalNumber(json, 'coupon_amount') ??
          _readOptionalNumber(json, 'couponAmount') ??
          0,
      shopName: _readOptionalString(
        json,
        'shop_name',
        fallback: _readOptionalString(json, 'shopName', fallback: ''),
      ),
      sales: _readOptionalString(
        json,
        'sales',
        fallback: _readOptionalString(
          json,
          'volume',
          fallback: _readOptionalString(json, 'annual_vol', fallback: ''),
        ),
      ).trim().isEmpty
          ? null
          : _readOptionalString(
              json,
              'sales',
              fallback: _readOptionalString(
                json,
                'volume',
                fallback: _readOptionalString(
                  json,
                  'annual_vol',
                  fallback: '',
                ),
              ),
            ),
      recommendationReason: _readOptionalString(
        json,
        'recommendation_reason',
        fallback: _readOptionalString(
          json,
          'recommendationReason',
          fallback: '',
        ),
      ),
      matchExplanation: _readOptionalString(
        json,
        'match_explanation',
        fallback: _readOptionalString(
          json,
          'matchExplanation',
          fallback: '',
        ),
      ),
      isMock: json['is_mock'] as bool? ??
          json['isMock'] as bool? ??
          _readString(json, 'platform').toLowerCase().contains('mock'),
      tags: (json['tags'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .map((tag) => tag.trim())
          .where((tag) => tag.isNotEmpty)
          .toList(growable: false),
    );
  }

  final String productId;
  final String category;
  final String keyword;
  final String title;
  final String brand;
  final String color;
  final String size;
  final String imageUrl;
  final double price;
  final String platform;
  final double commissionRate;
  final String detailUrl;
  final String affiliateUrl;
  final String stockStatus;
  final double? originalPrice;
  final double couponAmount;
  final String shopName;
  final String? sales;
  final String recommendationReason;
  final String matchExplanation;
  final bool isMock;
  final List<String> tags;

  // Compatibility aliases used by the existing Product and analytics layers.
  String get id => productId;
  String get image => imageUrl;
  String get purchaseUrl => affiliateUrl.isNotEmpty ? affiliateUrl : detailUrl;
  double get commission => price * commissionRate;

  bool get isPurchasable {
    final uri = Uri.tryParse(purchaseUrl);
    return isInStock &&
        uri != null &&
        !isMock &&
        uri.scheme == 'https' &&
        uri.host.isNotEmpty;
  }

  bool get isInStock =>
      !{'out_of_stock', 'sold_out', 'unavailable'}.contains(stockStatus);

  Product toProduct() {
    final priceText = price == price.roundToDouble()
        ? price.toStringAsFixed(0)
        : price.toStringAsFixed(2);

    return Product(
      id: productId,
      sku: 'CATALOG-${productId.toUpperCase()}',
      brand: brand,
      name: title,
      category: category,
      imageUrl: imageUrl,
      color: color,
      size: size,
      material: '以商品页为准',
      price: priceText,
      buyUrl: purchaseUrl,
      stock: isInStock ? 1 : 0,
      description: '来自 $platform 的商品库匹配结果',
      style: tags.isEmpty ? keyword : tags.first,
      season: '四季',
      fitType: keyword,
      aiReason: recommendationReason.isEmpty
          ? '根据本次 AI 穿搭关键词“$keyword”匹配'
          : recommendationReason,
      styleTags: tags,
      tryOnAvailable: isInStock,
      isAvailable: isInStock,
      affiliateChannelId: platform,
      sourceProvider: platform,
      commissionRate: commissionRate,
      originalPrice: originalPrice == null
          ? null
          : originalPrice == originalPrice!.roundToDouble()
              ? originalPrice!.toStringAsFixed(0)
              : originalPrice!.toStringAsFixed(2),
      couponAmount: couponAmount,
      shopName: shopName,
      sales: sales,
      recommendationReason: recommendationReason,
      matchExplanation: matchExplanation,
      isMock: isMock,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'product_id': productId,
      'title': title,
      'brand': brand,
      'category': category,
      'price': price,
      'image_url': imageUrl,
      'detail_url': detailUrl,
      'platform': platform,
      'commission_rate': commissionRate,
      'affiliate_url': affiliateUrl,
      'stock_status': stockStatus,
      'original_price': originalPrice,
      'coupon_amount': couponAmount,
      'shop_name': shopName,
      'sales': sales,
      'recommendation_reason': recommendationReason,
      'match_explanation': matchExplanation,
      'is_mock': isMock,
    };
  }

  static String _readString(Map<String, dynamic> json, String key) {
    final value = json[key];
    if (value is! String || value.trim().isEmpty) {
      throw FormatException('Missing string field: $key');
    }
    return value.trim();
  }

  static String _readAliasedString(
    Map<String, dynamic> json,
    List<String> keys, {
    String? fallback,
  }) {
    for (final key in keys) {
      final value = json[key];
      if (value is String && value.trim().isNotEmpty) {
        return value.trim();
      }
    }
    if (fallback != null) return fallback;
    throw FormatException('Missing string field: ${keys.join('/')}');
  }

  static double _readNumber(Map<String, dynamic> json, String key) {
    final value = _readOptionalNumber(json, key);
    if (value == null || !value.isFinite || value < 0) {
      throw FormatException('$key must be a non-negative number');
    }
    return value;
  }

  static double? _readOptionalNumber(Map<String, dynamic> json, String key) {
    final value = json[key];
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value.trim());
    return null;
  }

  static String _readOptionalString(
    Map<String, dynamic> json,
    String key, {
    required String fallback,
  }) {
    final value = json[key];
    return value is String && value.trim().isNotEmpty ? value.trim() : fallback;
  }
}
