import 'package:flutter/material.dart';

import '../models/admin_analytics_snapshot.dart';
import '../services/admin_analytics_service.dart';

class AdminAnalyticsPage extends StatefulWidget {
  const AdminAnalyticsPage({
    this.service,
    super.key,
  });

  final AdminAnalyticsService? service;

  @override
  State<AdminAnalyticsPage> createState() => _AdminAnalyticsPageState();
}

class _AdminAnalyticsPageState extends State<AdminAnalyticsPage> {
  late final AdminAnalyticsService _service;
  late Future<AdminAnalyticsSnapshot> _snapshot;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? AdminAnalyticsService();
    _snapshot = _service.load();
  }

  void _reload() {
    setState(() => _snapshot = _service.load());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F6F3),
      appBar: AppBar(
        title: const Text('运营数据'),
        backgroundColor: const Color(0xFFF7F6F3),
        actions: [
          IconButton(
            key: const Key('refresh-admin-analytics'),
            onPressed: _reload,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: FutureBuilder<AdminAnalyticsSnapshot>(
        future: _snapshot,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError || !snapshot.hasData) {
            return _ErrorState(onRetry: _reload);
          }
          return _Dashboard(snapshot: snapshot.requireData);
        },
      ),
    );
  }
}

class _Dashboard extends StatelessWidget {
  const _Dashboard({required this.snapshot});

  final AdminAnalyticsSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final metrics = [
      ('用户数量', '${snapshot.totalUsers}', Icons.people_outline_rounded),
      ('活跃用户', '${snapshot.activeUsers}', Icons.bolt_rounded),
      (
        '今日新增用户',
        '${snapshot.dailyNewUsers}',
        Icons.person_add_alt_1_outlined,
      ),
      (
        '上传照片人数',
        '${snapshot.dailyPhotoUploadUsers}',
        Icons.add_a_photo_outlined,
      ),
      (
        '今日生成次数',
        '${snapshot.dailyOutfitGenerationCount}',
        Icons.auto_awesome_outlined,
      ),
      (
        '今日商品曝光',
        '${snapshot.dailyProductImpressions}',
        Icons.visibility_outlined,
      ),
      (
        '今日商品点击',
        '${snapshot.dailyProductClicks}',
        Icons.touch_app_outlined,
      ),
      (
        '今日查看商品',
        '${snapshot.dailyProductDetailViews}',
        Icons.open_in_full_rounded,
      ),
      (
        '今日购买意向',
        '${snapshot.dailyPurchaseIntentCount}',
        Icons.shopping_bag_outlined,
      ),
      (
        '今日收藏',
        '${snapshot.dailyFavoriteCount}',
        Icons.favorite_border,
      ),
      (
        '今日购买跳转',
        '${snapshot.dailyPurchaseRedirectCount}',
        Icons.open_in_new_rounded,
      ),
      (
        '预计佣金',
        '¥${snapshot.potentialCommission.toStringAsFixed(2)}',
        Icons.payments_outlined,
      ),
      (
        '确认佣金',
        '¥${snapshot.confirmedCommission.toStringAsFixed(2)}',
        Icons.verified_outlined,
      ),
      (
        '今日反馈',
        '${snapshot.dailyFeedbackCount}',
        Icons.rate_review_outlined,
      ),
      (
        '平均满意度',
        snapshot.averageSatisfaction.toStringAsFixed(1),
        Icons.star_outline_rounded,
      ),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
      children: [
        const Text(
          '今日用户验证数据',
          style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 7),
        Text(
          '数据范围：${snapshot.dataScope}。预计佣金按购买跳转商品价格 × 渠道佣金率计算，最终以联盟订单回传为准。',
          style: const TextStyle(color: Color(0xFF756E69), height: 1.5),
        ),
        const SizedBox(height: 20),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 760 ? 4 : 2;
            const gap = 12.0;
            final width =
                (constraints.maxWidth - gap * (columns - 1)) / columns;
            return Wrap(
              spacing: gap,
              runSpacing: gap,
              children: [
                for (final metric in metrics)
                  SizedBox(
                    width: width,
                    child: _MetricCard(
                      label: metric.$1,
                      value: metric.$2,
                      icon: metric.$3,
                    ),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: 28),
        const Text(
          '转化漏斗',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 12),
        _FunnelRow(
          label: '曝光 → 点击',
          value: snapshot.dailyClickThroughRate,
        ),
        _FunnelRow(
          label: '点击 → 收藏',
          value: snapshot.dailyFavoriteRate,
        ),
        _FunnelRow(
          label: '点击 → 购买跳转',
          value: snapshot.dailyPurchaseRedirectRate,
        ),
        _FunnelRow(
          label: '查看商品 → 点击购买',
          value: snapshot.detailToPurchaseIntentRate,
        ),
        _FunnelRow(
          label: '反馈用户购买意愿',
          value: snapshot.purchaseIntentRate,
        ),
        if (snapshot.noPurchaseReasons.isNotEmpty) ...[
          const SizedBox(height: 18),
          const Text(
            '今日不购买原因',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 9),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final entry in snapshot.noPurchaseReasons.entries)
                Chip(label: Text('${entry.key} ${entry.value}')),
            ],
          ),
        ],
        const SizedBox(height: 20),
        Text(
          '累计：${snapshot.productImpressions} 次曝光 · '
          '${snapshot.productClicks} 次点击 · '
          '${snapshot.favoriteCount} 次收藏 · '
          '${snapshot.tryOnCount} 次试穿 · '
          '${snapshot.purchaseRedirectCount} 次购买跳转 · '
          '${snapshot.purchaseCompletedCount} 笔确认订单',
          style: const TextStyle(color: Color(0xFF756E69), height: 1.5),
        ),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0B000000),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: const Color(0xFF6F5F7B)),
            const SizedBox(height: 18),
            Text(
              value,
              style: const TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            Text(label, style: const TextStyle(color: Color(0xFF756E69))),
          ],
        ),
      ),
    );
  }
}

class _FunnelRow extends StatelessWidget {
  const _FunnelRow({required this.label, required this.value});

  final String label;
  final double value;

  @override
  Widget build(BuildContext context) {
    final normalized = value.clamp(0, 1).toDouble();
    return Padding(
      padding: const EdgeInsets.only(bottom: 15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label),
              Text('${(value * 100).toStringAsFixed(1)}%'),
            ],
          ),
          const SizedBox(height: 7),
          LinearProgressIndicator(
            value: normalized,
            minHeight: 8,
            borderRadius: BorderRadius.circular(8),
            color: const Color(0xFF6F5F7B),
            backgroundColor: const Color(0xFFE9E4EC),
          ),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline_rounded, size: 42),
          const SizedBox(height: 12),
          const Text('运营数据加载失败'),
          const SizedBox(height: 12),
          FilledButton(onPressed: onRetry, child: const Text('重新加载')),
        ],
      ),
    );
  }
}
