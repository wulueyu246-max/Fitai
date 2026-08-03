import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/product.dart';
import '../models/product_analytics.dart';
import 'analytics_service.dart';

class ProductAnalyticsService {
  ProductAnalyticsService({
    SharedPreferencesAsync? storage,
    AnalyticsService? analyticsService,
  })  : _storage = storage,
        _analyticsService = analyticsService ?? LocalAnalyticsService.instance;

  static final ProductAnalyticsService instance = ProductAnalyticsService();
  static const _key = 'fitai.product_analytics.v1';
  static const _limit = 1000;

  SharedPreferencesAsync? _storage;
  final AnalyticsService _analyticsService;
  final List<ProductAnalyticsEvent> _events = [];
  Future<void>? _loadFuture;

  Future<void> _ensureLoaded() => _loadFuture ??= _load();

  Future<ConversionEvent> record({
    required ProductAnalyticsAction action,
    required Product product,
    required String source,
    String userId = 'local-demo-user',
    String? orderId,
    String? attributionId,
  }) async {
    await _ensureLoaded();
    final now = DateTime.now();
    final event = ConversionEvent(
      id: 'product-event-${now.microsecondsSinceEpoch}',
      productId: product.id,
      action: action,
      source: source,
      createdAt: now,
      userId: userId,
      sku: product.sku,
      brand: product.brand,
      commission: product.commission,
      productPrice: product.numericPrice,
      affiliateChannelId: product.affiliateChannelId,
      attributionId: attributionId,
      orderId: orderId,
    );
    _events.insert(0, event);
    if (_events.length > _limit) {
      _events.removeRange(_limit, _events.length);
    }
    await Future.wait([
      _save(),
      _analyticsService.track(
        _eventName(action),
        properties: {
          'productId': product.id,
          'sku': product.sku,
          'brand': product.brand,
          'source': source,
          'platform': product.sourceProvider.isNotEmpty
              ? product.sourceProvider
              : product.affiliateChannelId.isNotEmpty
                  ? product.affiliateChannelId
                  : 'unknown',
          'affiliateChannelId': product.affiliateChannelId,
          'commissionRate': product.commission.toString(),
          'productPrice': product.numericPrice.toString(),
          if (attributionId != null) 'attributionId': attributionId,
          if (orderId != null) 'orderId': orderId,
        },
        userId: userId,
      ),
    ]);
    return event;
  }

  Future<void> recordImpressions(
    Iterable<Product> products, {
    required String source,
    String userId = 'local-demo-user',
  }) async {
    for (final product in products) {
      await record(
        action: ProductAnalyticsAction.impression,
        product: product,
        source: source,
        userId: userId,
      );
    }
  }

  Future<ProductConversionFunnel> getFunnel({String? productId}) async {
    await _ensureLoaded();
    final events = productId == null
        ? _events
        : _events.where((event) => event.productId == productId);
    int count(ProductAnalyticsAction action) {
      return events.where((event) => event.action == action).length;
    }

    return ProductConversionFunnel(
      impressions: count(ProductAnalyticsAction.impression),
      clicks: count(ProductAnalyticsAction.click),
      favorites: count(ProductAnalyticsAction.favorite),
      tryOns: count(ProductAnalyticsAction.tryOn),
      purchaseRedirects: count(ProductAnalyticsAction.purchaseRedirect),
      purchasesCompleted: count(ProductAnalyticsAction.purchaseCompleted),
    );
  }

  Future<ProductAnalytics> getSnapshot({String? productId}) async {
    final funnel = await getFunnel(productId: productId);
    final events = productId == null
        ? _events
        : _events.where((event) => event.productId == productId).toList();
    return ProductAnalytics(
      events: List<ProductAnalyticsEvent>.unmodifiable(events),
      funnel: funnel,
    );
  }

  Future<void> _load() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final values = await storage.getStringList(_key) ?? const [];
      _events
        ..clear()
        ..addAll(
          values.map((value) {
            final json = jsonDecode(value);
            return ConversionEvent.fromJson(
              json as Map<String, dynamic>,
            );
          }),
        );
    } catch (_) {
      _events.clear();
    }
  }

  Future<void> _save() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setStringList(
        _key,
        _events.map((event) => jsonEncode(event.toJson())).toList(),
      );
    } catch (_) {
      // Conversion logging must not block shopping actions.
    }
  }

  String _eventName(ProductAnalyticsAction action) {
    return switch (action) {
      ProductAnalyticsAction.impression => 'product_impression',
      ProductAnalyticsAction.click => 'product_click',
      ProductAnalyticsAction.favorite => 'product_favorite',
      ProductAnalyticsAction.tryOn => 'product_try_on',
      ProductAnalyticsAction.purchaseRedirect => 'product_purchase_redirect',
      ProductAnalyticsAction.purchaseCompleted => 'product_purchase_completed',
    };
  }
}
