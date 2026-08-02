import '../models/brand_partner.dart';

abstract interface class BrandPartnerService {
  Future<List<BrandPartner>> getPartners();

  Future<BrandPartner?> getByBrandId(String brandId);

  Future<void> submitCooperationIntent({
    required String brandId,
    required String contact,
  });
}

class MockBrandPartnerService implements BrandPartnerService {
  const MockBrandPartnerService();

  static const _partners = [
    BrandPartner(
      id: 'partner-uniqlo',
      brandId: 'uniqlo',
      brandName: 'UNIQLO',
      status: BrandPartnerStatus.mockConnected,
      modes: [
        BrandPartnershipMode.catalogApi,
        BrandPartnershipMode.affiliateCommission,
      ],
      campaignTitle: 'AI 基础衣橱计划',
      contactEmail: 'partner-demo@fitai.local',
      commissionRate: 0.08,
    ),
    BrandPartner(
      id: 'partner-nike',
      brandId: 'nike',
      brandName: 'Nike',
      status: BrandPartnerStatus.mockConnected,
      modes: [
        BrandPartnershipMode.catalogApi,
        BrandPartnershipMode.sponsoredRecommendation,
      ],
      campaignTitle: '城市运动 AI Look',
      contactEmail: 'partner-demo@fitai.local',
    ),
    BrandPartner(
      id: 'partner-adidas',
      brandId: 'adidas',
      brandName: 'Adidas',
      status: BrandPartnerStatus.prospect,
      modes: [
        BrandPartnershipMode.affiliateCommission,
        BrandPartnershipMode.campaignRevenueShare,
      ],
      campaignTitle: '运动生活方式合作位',
      contactEmail: 'partner-demo@fitai.local',
      commissionRate: 0.07,
    ),
    BrandPartner(
      id: 'partner-zara',
      brandId: 'zara',
      brandName: 'ZARA',
      status: BrandPartnerStatus.prospect,
      modes: [
        BrandPartnershipMode.catalogApi,
        BrandPartnershipMode.campaignRevenueShare,
      ],
      campaignTitle: '趋势胶囊衣橱',
      contactEmail: 'partner-demo@fitai.local',
    ),
  ];

  @override
  Future<List<BrandPartner>> getPartners() async => _partners;

  @override
  Future<BrandPartner?> getByBrandId(String brandId) async {
    for (final partner in _partners) {
      if (partner.brandId == brandId) {
        return partner;
      }
    }
    return null;
  }

  @override
  Future<void> submitCooperationIntent({
    required String brandId,
    required String contact,
  }) async {
    if (brandId.trim().isEmpty || contact.trim().isEmpty) {
      throw ArgumentError('Brand and contact are required');
    }
  }
}
