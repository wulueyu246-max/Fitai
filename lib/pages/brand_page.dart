import 'package:flutter/material.dart';

import '../components/product_grid.dart';
import '../models/brand.dart';
import '../models/brand_partner.dart';
import '../models/product.dart';
import '../models/product_analytics.dart';
import '../services/affiliate_service.dart';
import '../services/brand_service.dart';
import '../services/brand_partner_service.dart';
import '../services/favorite_service.dart';
import '../services/product_analytics_service.dart';
import 'product_detail_page.dart';

class BrandPage extends StatefulWidget {
  const BrandPage({
    required this.brand,
    this.onTryOn,
    this.brandService = const MockBrandService(),
    this.partnerService = const MockBrandPartnerService(),
    super.key,
  });

  final Brand brand;
  final ValueChanged<Product>? onTryOn;
  final BrandService brandService;
  final BrandPartnerService partnerService;

  @override
  State<BrandPage> createState() => _BrandPageState();
}

class _BrandPageState extends State<BrandPage> {
  final FavoriteService _favoriteService = FavoriteService.instance;
  final ProductAnalyticsService _analytics = ProductAnalyticsService.instance;
  final AffiliateService _affiliateService = LocalAffiliateService();
  List<Product> _products = const [];
  BrandPartner? _partner;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _favoriteService.addListener(_onFavoriteChanged);
    _load();
  }

  @override
  void dispose() {
    _favoriteService.removeListener(_onFavoriteChanged);
    super.dispose();
  }

  void _onFavoriteChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait<Object?>([
        widget.brandService.getBrandProducts(widget.brand.id),
        widget.partnerService.getByBrandId(widget.brand.id),
      ]);
      final products = results[0]! as List<Product>;
      final partner = results[1] as BrandPartner?;
      await _favoriteService.ensureLoaded();
      await _analytics.recordImpressions(
        products,
        source: 'brand-page-${widget.brand.id}',
      );
      if (mounted) {
        setState(() {
          _products = products;
          _partner = partner;
          _loading = false;
          _error = null;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = '品牌商品加载失败，请稍后重试';
        });
      }
    }
  }

  Future<void> _openDetails(Product product) async {
    await _affiliateService.recordProductClick(
      product: product,
      source: 'brand-page-${widget.brand.id}',
    );
    if (!mounted) {
      return;
    }
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ProductDetailPage(
          product: product,
          trackOpen: false,
          onFavorite: _toggleFavorite,
          onAddToWardrobe: _addToWardrobe,
        ),
      ),
    );
  }

  Future<void> _addToWardrobe(Product product) async {
    if (!_favoriteService.isProductFavorite(product.id)) {
      await _toggleFavorite(product);
    }
  }

  Future<void> _toggleFavorite(Product product) async {
    final favorite = await _favoriteService.toggleProduct(product);
    if (favorite) {
      await _analytics.record(
        action: ProductAnalyticsAction.favorite,
        product: product,
        source: 'brand-page-${widget.brand.id}',
      );
    }
  }

  Future<void> _tryOn(Product product) async {
    final onTryOn = widget.onTryOn;
    if (onTryOn == null) return;
    await _analytics.record(
      action: ProductAnalyticsAction.tryOn,
      product: product,
      source: 'brand-page-${widget.brand.id}',
    );
    onTryOn(product);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F6F3),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF7F6F3),
        title: Text(widget.brand.name),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: FilledButton.icon(
                    onPressed: _load,
                    icon: const Icon(Icons.refresh_rounded),
                    label: Text(_error!),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(18, 8, 18, 40),
                  children: [
                    _BrandHero(brand: widget.brand),
                    const SizedBox(height: 20),
                    _BrandPartnerCard(
                      partner: _partner,
                      onCooperate: _submitCooperationIntent,
                    ),
                    const SizedBox(height: 28),
                    const Text(
                      'AI推荐专区',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 5),
                    const Text(
                      '结合身材比例、风格偏好和预算排序',
                      style: TextStyle(color: Color(0xFF7B756F)),
                    ),
                    const SizedBox(height: 16),
                    ProductGrid(
                      products: _products,
                      selectedProductIds: const {},
                      onProductTap: _openDetails,
                      onViewDetails: _openDetails,
                      onProductTryOn: widget.onTryOn == null ? null : _tryOn,
                      favoriteProductIds: _favoriteService.productIds,
                      onFavorite: _toggleFavorite,
                    ),
                  ],
                ),
    );
  }

  Future<void> _submitCooperationIntent() async {
    await widget.partnerService.submitCooperationIntent(
      brandId: widget.brand.id,
      contact: 'local-demo-user@fitai.local',
    );
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('品牌合作意向已记录（Mock），未向外部发送数据'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

class _BrandPartnerCard extends StatelessWidget {
  const _BrandPartnerCard({
    required this.partner,
    required this.onCooperate,
  });

  final BrandPartner? partner;
  final VoidCallback onCooperate;

  @override
  Widget build(BuildContext context) {
    final modes =
        partner?.modes.map(_modeLabel).join(' · ') ?? '商品目录 · AI推荐专区 · 合作入口';
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE9E4DF)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.handshake_outlined, color: Color(0xFF244C3A)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  partner?.campaignTitle ?? '树皮 Shupi 品牌合作计划',
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 5),
                Text(
                  modes,
                  style: const TextStyle(
                    color: Color(0xFF77706B),
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            key: const Key('brand-cooperation-entry'),
            onPressed: onCooperate,
            child: const Text('合作'),
          ),
        ],
      ),
    );
  }

  static String _modeLabel(BrandPartnershipMode mode) {
    return switch (mode) {
      BrandPartnershipMode.catalogApi => '商品API',
      BrandPartnershipMode.affiliateCommission => '佣金',
      BrandPartnershipMode.sponsoredRecommendation => '推荐合作',
      BrandPartnershipMode.campaignRevenueShare => '活动分成',
    };
  }
}

class _BrandHero extends StatelessWidget {
  const _BrandHero({required this.brand});

  final Brand brand;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF1F4434), Color(0xFF8A6246)],
        ),
        borderRadius: BorderRadius.circular(28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 28,
            backgroundColor: Colors.white,
            child: Text(
              brand.shortName,
              style: const TextStyle(
                color: Color(0xFF244C3A),
                fontSize: 20,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text(
            brand.name,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 30,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '树皮 Shupi 品牌合作入口 · '
            '${brand.supportedCategories.take(4).join(' / ')}',
            style: const TextStyle(
              color: Color(0xFFD7D0D9),
              height: 1.5,
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
            decoration: BoxDecoration(
              color: const Color(0x22FFFFFF),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              brand.apiAvailable ? '实时品牌API已连接' : 'Mock合作商品库',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
