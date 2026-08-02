import 'dart:async';

import 'package:flutter/material.dart';

import '../core/logging/app_logger.dart';
import '../components/product_image.dart';
import '../models/product.dart';
import '../models/product_analytics.dart';
import '../services/affiliate_service.dart';
import '../services/analytics_service.dart';
import '../services/favorite_service.dart';
import '../services/product_analytics_service.dart';
import '../services/purchase_launcher.dart';

class ProductDetailPage extends StatefulWidget {
  const ProductDetailPage({
    required this.product,
    this.onFavorite,
    this.onAddToWardrobe,
    this.onTryOn,
    this.onPurchase,
    this.affiliateService,
    this.purchaseLauncher,
    this.analyticsService,
    this.userId = 'local-demo-user',
    this.trackOpen = true,
    super.key,
  });

  final Product product;
  final Future<void> Function(Product product)? onFavorite;
  final Future<void> Function(Product product)? onAddToWardrobe;
  final Future<void> Function(Product product)? onTryOn;
  final Future<void> Function(Product product)? onPurchase;
  final AffiliateService? affiliateService;
  final PurchaseLauncher? purchaseLauncher;
  final AnalyticsService? analyticsService;
  final String userId;
  final bool trackOpen;

  @override
  State<ProductDetailPage> createState() => _ProductDetailPageState();
}

class _ProductDetailPageState extends State<ProductDetailPage> {
  final FavoriteService _favorites = FavoriteService.instance;
  final ProductAnalyticsService _analytics = ProductAnalyticsService.instance;
  late final AnalyticsService _eventAnalytics =
      widget.analyticsService ?? LocalAnalyticsService.instance;
  late final AffiliateService _affiliateService = widget.affiliateService ??
      LocalAffiliateService(
        analytics: _analytics,
        purchaseLauncher:
            widget.purchaseLauncher ?? const ExternalPurchaseLauncher(),
      );
  String? _busyAction;

  @override
  void initState() {
    super.initState();
    _favorites.addListener(_refresh);
    unawaited(_favorites.ensureLoaded());
    unawaited(
      _eventAnalytics.track(
        'product_detail_view',
        userId: widget.userId,
        properties: {
          'productId': widget.product.id,
          'sku': widget.product.sku,
          'source': 'product-detail-page',
        },
      ),
    );
    if (widget.trackOpen) {
      unawaited(
        _affiliateService.recordProductClick(
          product: widget.product,
          source: 'product-detail-page',
          userId: widget.userId,
        ),
      );
    }
  }

  @override
  void dispose() {
    _favorites.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _run(
    String action,
    Future<void> Function() callback,
  ) async {
    if (_busyAction != null) {
      return;
    }
    setState(() => _busyAction = action);
    try {
      await callback();
    } catch (error, stackTrace) {
      AppLogger.instance.error(
        'product_detail_action_failed',
        error: error,
        stackTrace: stackTrace,
        metadata: {
          'action': action,
          'productId': widget.product.id,
          'sku': widget.product.sku,
        },
      );
      _message(
        error is PurchaseLaunchException ? error.message : '操作失败，请稍后重试',
      );
    } finally {
      if (mounted) {
        setState(() => _busyAction = null);
      }
    }
  }

  Future<void> _favorite() {
    return _run('favorite', () async {
      if (widget.onFavorite case final callback?) {
        await callback(widget.product);
      } else {
        final selected = await _favorites.toggleProduct(widget.product);
        if (selected) {
          await _analytics.record(
            action: ProductAnalyticsAction.favorite,
            product: widget.product,
            source: 'product-detail-page',
            userId: widget.userId,
          );
        }
      }
    });
  }

  Future<void> _addToWardrobe() {
    return _run('wardrobe', () async {
      if (widget.onAddToWardrobe case final callback?) {
        await callback(widget.product);
      } else if (!_favorites.isProductFavorite(widget.product.id)) {
        await _favorites.toggleProduct(widget.product);
        await _analytics.record(
          action: ProductAnalyticsAction.favorite,
          product: widget.product,
          source: 'product-detail-wardrobe',
          userId: widget.userId,
        );
      }
      _message('商品已加入我的衣橱');
    });
  }

  Future<void> _tryOn() {
    return _run('tryOn', () async {
      if (widget.onTryOn case final callback?) {
        await callback(widget.product);
      } else {
        await _analytics.record(
          action: ProductAnalyticsAction.tryOn,
          product: widget.product,
          source: 'product-detail-page',
          userId: widget.userId,
        );
      }
    });
  }

  Future<void> _purchase() {
    return _run('purchase', () async {
      await _eventAnalytics.track(
        'purchase_intent',
        userId: widget.userId,
        properties: {
          'productId': widget.product.id,
          'sku': widget.product.sku,
          'source': 'product-detail-page',
        },
      );
      await _affiliateService.openPurchase(
        product: widget.product,
        source: 'product-detail-page',
        userId: widget.userId,
      );
      if (widget.onPurchase case final callback?) {
        await callback(widget.product);
      }
      AppLogger.instance.info(
        'product_purchase_opened',
        metadata: {
          'productId': widget.product.id,
          'sku': widget.product.sku,
          'commissionRate': widget.product.commissionRate,
        },
      );
      _message('已打开品牌购买页面');
    });
  }

  void _message(String value) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(value), behavior: SnackBarBehavior.floating),
      );
  }

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    final favorite = _favorites.isProductFavorite(product.id);
    return Scaffold(
      backgroundColor: const Color(0xFFF7F6F3),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF7F6F3),
        title: const Text('商品详情'),
        actions: [
          IconButton(
            key: Key('detail-favorite-${product.id}'),
            onPressed: _busyAction == null ? _favorite : null,
            icon: Icon(
              favorite ? Icons.favorite_rounded : Icons.favorite_border_rounded,
              color: favorite ? const Color(0xFFC94257) : null,
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 4, 18, 40),
        children: [
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(28),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: AspectRatio(
                      aspectRatio: 4 / 3,
                      child: ProductImage(
                        product: product,
                        fit: BoxFit.contain,
                      ),
                    ),
                  ),
                  const SizedBox(height: 22),
                  if (!product.isAvailable) ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFECEA),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: const Text(
                        '该商品当前已下架，不会进入 AI 推荐，也不能购买或试穿。',
                        style: TextStyle(
                          color: Color(0xFFA23B32),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  Text(
                    product.brand,
                    style: const TextStyle(
                      color: Color(0xFF695777),
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.8,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          product.name,
                          style: const TextStyle(
                            fontSize: 25,
                            height: 1.25,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Text(
                        product.displayPrice,
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'SKU ${product.sku} · ${product.category} · '
                    '${product.inStock ? "库存 ${product.stock}" : "暂时缺货"}',
                    style: const TextStyle(color: Color(0xFF817A74)),
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _ProductMeta(product.style),
                      _ProductMeta(product.color),
                      _ProductMeta(product.material),
                      _ProductMeta(product.fitType),
                      _ProductMeta(product.size),
                    ],
                  ),
                  const SizedBox(height: 22),
                  Text(
                    product.description,
                    style: const TextStyle(
                      color: Color(0xFF5F5954),
                      fontSize: 14,
                      height: 1.6,
                    ),
                  ),
                  const SizedBox(height: 18),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(17),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEFEAF2),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'AI为什么推荐',
                          style: TextStyle(
                            color: Color(0xFF695777),
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 7),
                        Text(
                          product.aiReason,
                          style: const TextStyle(height: 1.55),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 22),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          key: Key('detail-wardrobe-${product.id}'),
                          onPressed:
                              _busyAction == null ? _addToWardrobe : null,
                          icon: const Icon(Icons.checkroom_outlined),
                          label: const Text('加入衣橱'),
                        ),
                      ),
                      if (widget.onTryOn != null) ...[
                        const SizedBox(width: 10),
                        Expanded(
                          child: OutlinedButton.icon(
                            key: Key('detail-try-on-${product.id}'),
                            onPressed: product.isAvailable &&
                                    product.tryOnAvailable &&
                                    _busyAction == null
                                ? _tryOn
                                : null,
                            icon: const Icon(Icons.accessibility_new_rounded),
                            label: const Text('立即试穿'),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      key: Key('detail-buy-${product.id}'),
                      onPressed: product.isPurchasable && _busyAction == null
                          ? _purchase
                          : null,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF211E23),
                        padding: const EdgeInsets.symmetric(vertical: 16),
                      ),
                      icon: const Icon(Icons.shopping_bag_outlined),
                      label: const Text(
                        '立即购买',
                        style: TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    '购买将在品牌或合作方页面完成，库存、支付与售后由合作方负责。\n'
                    '树皮会记录匿名购买跳转，用于优化推荐效果。',
                    style: const TextStyle(
                      color: Color(0xFF8B847E),
                      fontSize: 10.5,
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProductMeta extends StatelessWidget {
  const _ProductMeta(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFE6E1DC)),
      ),
      child: Text(label, style: const TextStyle(fontSize: 11)),
    );
  }
}
