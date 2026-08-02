import '../models/affiliate_revenue_summary.dart';
import '../models/product_analytics.dart';
import 'product_analytics_service.dart';

class AffiliateRevenueService {
  AffiliateRevenueService({ProductAnalyticsService? analytics})
      : _analytics = analytics ?? ProductAnalyticsService.instance;

  final ProductAnalyticsService _analytics;

  Future<AffiliateRevenueSummary> load() async {
    final snapshot = await _analytics.getSnapshot();
    final redirectEvents = snapshot.events.where(
      (event) => event.action == ProductAnalyticsAction.purchaseRedirect,
    );
    final confirmedEvents = snapshot.events.where(
      (event) => event.action == ProductAnalyticsAction.purchaseCompleted,
    );
    final brandCommission = <String, double>{};
    for (final event in confirmedEvents) {
      brandCommission[event.brand] = (brandCommission[event.brand] ?? 0) +
          event.productPrice * event.commission;
    }
    return AffiliateRevenueSummary(
      impressions: snapshot.funnel.impressions,
      clicks: snapshot.funnel.clicks,
      favorites: snapshot.funnel.favorites,
      tryOns: snapshot.funnel.tryOns,
      purchaseRedirects: snapshot.funnel.purchaseRedirects,
      confirmedOrders: snapshot.funnel.purchasesCompleted,
      potentialCommission: redirectEvents.fold<double>(
        0,
        (sum, event) => sum + event.productPrice * event.commission,
      ),
      confirmedCommission: confirmedEvents.fold<double>(
        0,
        (sum, event) => sum + event.productPrice * event.commission,
      ),
      brandCommission: Map.unmodifiable(brandCommission),
      channelIds: Set.unmodifiable(
        snapshot.events
            .map((event) => event.affiliateChannelId)
            .where((channel) => channel.isNotEmpty),
      ),
      updatedAt: DateTime.now(),
    );
  }
}
