class AffiliateRevenueSummary {
  const AffiliateRevenueSummary({
    required this.impressions,
    required this.clicks,
    required this.favorites,
    required this.tryOns,
    required this.purchaseRedirects,
    required this.confirmedOrders,
    required this.potentialCommission,
    required this.confirmedCommission,
    required this.brandCommission,
    required this.channelIds,
    required this.updatedAt,
  });

  final int impressions;
  final int clicks;
  final int favorites;
  final int tryOns;
  final int purchaseRedirects;
  final int confirmedOrders;
  final double potentialCommission;
  final double confirmedCommission;
  final Map<String, double> brandCommission;
  final Set<String> channelIds;
  final DateTime updatedAt;

  double get clickThroughRate => impressions == 0 ? 0 : clicks / impressions;
  double get purchaseRedirectRate =>
      clicks == 0 ? 0 : purchaseRedirects / clicks;
  double get orderConversionRate =>
      purchaseRedirects == 0 ? 0 : confirmedOrders / purchaseRedirects;
}
