import '../models/conversion_event.dart';
import '../models/product.dart';
import 'product_analytics_service.dart';
import 'purchase_launcher.dart';

abstract interface class AffiliateService {
  Future<ConversionEvent> recordProductClick({
    required Product product,
    required String source,
    String userId,
  });

  Future<ConversionEvent> openPurchase({
    required Product product,
    required String source,
    String userId,
  });

  Future<ConversionEvent> confirmPurchase({
    required Product product,
    required String orderId,
    required String source,
    String userId,
  });
}

class LocalAffiliateService implements AffiliateService {
  LocalAffiliateService({
    ProductAnalyticsService? analytics,
    PurchaseLauncher? purchaseLauncher,
  })  : _analytics = analytics ?? ProductAnalyticsService.instance,
        _purchaseLauncher =
            purchaseLauncher ?? const ExternalPurchaseLauncher();

  final ProductAnalyticsService _analytics;
  final PurchaseLauncher _purchaseLauncher;

  @override
  Future<ConversionEvent> recordProductClick({
    required Product product,
    required String source,
    String userId = 'local-demo-user',
  }) {
    return _analytics.record(
      action: ProductAnalyticsAction.click,
      product: product,
      source: source,
      userId: userId,
    );
  }

  @override
  Future<ConversionEvent> openPurchase({
    required Product product,
    required String source,
    String userId = 'local-demo-user',
  }) async {
    final attributionId = 'fitai-${DateTime.now().microsecondsSinceEpoch}';
    await _purchaseLauncher.open(
      product.copyWith(
        purchaseUrl: _withAttribution(product.purchaseUrl, attributionId),
      ),
    );
    return _analytics.record(
      action: ProductAnalyticsAction.purchaseRedirect,
      product: product,
      source: source,
      userId: userId,
      attributionId: attributionId,
    );
  }

  String _withAttribution(String purchaseUrl, String attributionId) {
    if (purchaseUrl.contains('{click_id}')) {
      return purchaseUrl.replaceAll(
        '{click_id}',
        Uri.encodeQueryComponent(attributionId),
      );
    }
    final uri = Uri.tryParse(purchaseUrl);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      return purchaseUrl;
    }
    return uri.replace(
      queryParameters: {
        ...uri.queryParameters,
        'fitai_click_id': attributionId,
      },
    ).toString();
  }

  @override
  Future<ConversionEvent> confirmPurchase({
    required Product product,
    required String orderId,
    required String source,
    String userId = 'local-demo-user',
  }) {
    final normalizedOrderId = orderId.trim();
    if (normalizedOrderId.isEmpty) {
      throw ArgumentError.value(orderId, 'orderId', '订单号不能为空');
    }
    return _analytics.record(
      action: ProductAnalyticsAction.purchaseCompleted,
      product: product,
      source: source,
      userId: userId,
      orderId: normalizedOrderId,
    );
  }
}
