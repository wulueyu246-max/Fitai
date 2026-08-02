enum BrandPartnershipMode {
  catalogApi,
  affiliateCommission,
  sponsoredRecommendation,
  campaignRevenueShare,
}

enum BrandPartnerStatus {
  prospect,
  mockConnected,
  active,
  paused,
}

class BrandPartner {
  const BrandPartner({
    required this.id,
    required this.brandId,
    required this.brandName,
    required this.status,
    required this.modes,
    required this.campaignTitle,
    required this.contactEmail,
    this.commissionRate,
  });

  final String id;
  final String brandId;
  final String brandName;
  final BrandPartnerStatus status;
  final List<BrandPartnershipMode> modes;
  final String campaignTitle;
  final String contactEmail;
  final double? commissionRate;

  bool get supportsCommission =>
      modes.contains(BrandPartnershipMode.affiliateCommission);
}
