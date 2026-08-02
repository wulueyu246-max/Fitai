enum ProductAnalyticsAction {
  impression,
  click,
  favorite,
  tryOn,
  purchaseRedirect,
  purchaseCompleted,
}

class ProductAnalyticsEvent {
  const ProductAnalyticsEvent({
    required this.id,
    required this.productId,
    required this.action,
    required this.source,
    required this.createdAt,
    this.userId = 'local-demo-user',
    this.sku = '',
    this.brand = '',
    this.commission = 0,
    this.productPrice = 0,
    this.affiliateChannelId = '',
    this.attributionId,
    this.orderId,
  });

  factory ProductAnalyticsEvent.fromJson(Map<String, dynamic> json) {
    return ProductAnalyticsEvent(
      id: json['id'] as String,
      productId: json['productId'] as String,
      action: ProductAnalyticsAction.values.firstWhere(
        (value) => value.name == json['action'],
        orElse: () => ProductAnalyticsAction.impression,
      ),
      source: json['source'] as String? ?? 'unknown',
      createdAt: DateTime.parse(json['createdAt'] as String),
      userId: json['userId'] as String? ?? 'local-demo-user',
      sku: json['sku'] as String? ?? '',
      brand: json['brand'] as String? ?? '',
      commission: (json['commission'] as num?)?.toDouble() ?? 0,
      productPrice: (json['productPrice'] as num?)?.toDouble() ?? 0,
      affiliateChannelId: json['affiliateChannelId'] as String? ?? '',
      attributionId: json['attributionId'] as String?,
      orderId: json['orderId'] as String?,
    );
  }

  final String id;
  final String userId;
  final String productId;
  final ProductAnalyticsAction action;
  final String source;
  final DateTime createdAt;
  final String sku;
  final String brand;
  final double commission;
  final double productPrice;
  final String affiliateChannelId;
  final String? attributionId;
  final String? orderId;

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'userId': userId,
      'productId': productId,
      'action': action.name,
      'source': source,
      'createdAt': createdAt.toIso8601String(),
      'sku': sku,
      'brand': brand,
      'commission': commission,
      'productPrice': productPrice,
      'affiliateChannelId': affiliateChannelId,
      'attributionId': attributionId,
      'orderId': orderId,
    };
  }
}

/// Commercial conversion record generated for each product funnel action.
class ConversionEvent extends ProductAnalyticsEvent {
  const ConversionEvent({
    required super.id,
    required super.productId,
    required super.action,
    required super.source,
    required super.createdAt,
    super.userId,
    super.sku,
    super.brand,
    super.commission,
    super.productPrice,
    super.affiliateChannelId,
    super.attributionId,
    super.orderId,
  });

  factory ConversionEvent.fromJson(Map<String, dynamic> json) {
    final event = ProductAnalyticsEvent.fromJson(json);
    return ConversionEvent(
      id: event.id,
      productId: event.productId,
      action: event.action,
      source: event.source,
      createdAt: event.createdAt,
      userId: event.userId,
      sku: event.sku,
      brand: event.brand,
      commission: event.commission,
      productPrice: event.productPrice,
      affiliateChannelId: event.affiliateChannelId,
      attributionId: event.attributionId,
      orderId: event.orderId,
    );
  }
}

class ProductConversionFunnel {
  const ProductConversionFunnel({
    required this.impressions,
    required this.clicks,
    required this.favorites,
    required this.tryOns,
    required this.purchaseRedirects,
    required this.purchasesCompleted,
  });

  final int impressions;
  final int clicks;
  final int favorites;
  final int tryOns;
  final int purchaseRedirects;
  final int purchasesCompleted;

  double get clickThroughRate => impressions == 0 ? 0 : clicks / impressions;
  double get tryOnRate => clicks == 0 ? 0 : tryOns / clicks;
  double get purchaseRedirectRate =>
      clicks == 0 ? 0 : purchaseRedirects / clicks;
  double get purchaseCompletionRate =>
      purchaseRedirects == 0 ? 0 : purchasesCompleted / purchaseRedirects;
}

class ProductAnalytics {
  const ProductAnalytics({
    required this.events,
    required this.funnel,
  });

  final List<ProductAnalyticsEvent> events;
  final ProductConversionFunnel funnel;
}
