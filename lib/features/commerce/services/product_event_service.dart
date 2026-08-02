import '../../../models/product.dart';
import '../../../models/product_analytics.dart';
import '../../../services/product_analytics_service.dart';
import '../models/conversion_funnel.dart';
import '../models/product_event.dart';

class ProductEventService {
  ProductEventService({ProductAnalyticsService? analytics})
      : _analytics = analytics ?? ProductAnalyticsService.instance;

  final ProductAnalyticsService _analytics;
  final List<ProductEvent> _events = [];

  Future<ProductEvent> record({
    required ProductEventType type,
    required Product product,
    required String source,
    String userId = 'local-demo-user',
    String? orderId,
  }) async {
    await _analytics.record(
      action: _toAnalyticsAction(type),
      product: product,
      source: source,
    );
    final now = DateTime.now();
    final event = ProductEvent(
      id: 'commerce-${now.microsecondsSinceEpoch}',
      productId: product.id,
      sku: product.sku,
      type: type,
      source: source,
      createdAt: now,
      userId: userId,
      orderId: orderId,
    );
    _events.insert(0, event);
    return event;
  }

  Future<ConversionFunnel> getFunnel({String? productId}) async {
    final funnel = await _analytics.getFunnel(productId: productId);
    return ConversionFunnel(
      impressions: funnel.impressions,
      clicks: funnel.clicks,
      favorites: funnel.favorites,
      addedToTryOn: funnel.tryOns,
      purchaseRedirects: funnel.purchaseRedirects,
      purchasesCompleted: funnel.purchasesCompleted,
    );
  }

  List<ProductEvent> get events => List<ProductEvent>.unmodifiable(_events);

  ProductAnalyticsAction _toAnalyticsAction(ProductEventType type) {
    return switch (type) {
      ProductEventType.impression => ProductAnalyticsAction.impression,
      ProductEventType.click => ProductAnalyticsAction.click,
      ProductEventType.favorite => ProductAnalyticsAction.favorite,
      ProductEventType.addToTryOn => ProductAnalyticsAction.tryOn,
      ProductEventType.purchaseRedirect =>
        ProductAnalyticsAction.purchaseRedirect,
      ProductEventType.purchaseCompleted =>
        ProductAnalyticsAction.purchaseCompleted,
    };
  }
}
