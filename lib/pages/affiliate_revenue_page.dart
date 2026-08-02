import 'package:flutter/material.dart';

import '../models/affiliate_revenue_summary.dart';
import '../services/affiliate_revenue_service.dart';

class AffiliateRevenuePage extends StatefulWidget {
  const AffiliateRevenuePage({
    this.service,
    super.key,
  });

  final AffiliateRevenueService? service;

  @override
  State<AffiliateRevenuePage> createState() => _AffiliateRevenuePageState();
}

class _AffiliateRevenuePageState extends State<AffiliateRevenuePage> {
  late final AffiliateRevenueService _service =
      widget.service ?? AffiliateRevenueService();
  late Future<AffiliateRevenueSummary> _summary = _service.load();

  void _reload() {
    setState(() => _summary = _service.load());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F6F3),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF7F6F3),
        title: const Text('联盟收益'),
        actions: [
          IconButton(
            key: const Key('refresh-affiliate-revenue'),
            onPressed: _reload,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: FutureBuilder<AffiliateRevenueSummary>(
        future: _summary,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError || snapshot.data == null) {
            return _RevenueError(onRetry: _reload);
          }
          return _RevenueContent(summary: snapshot.data!);
        },
      ),
    );
  }
}

class _RevenueContent extends StatelessWidget {
  const _RevenueContent({required this.summary});

  final AffiliateRevenueSummary summary;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
      children: [
        Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF211E23), Color(0xFF65516F)],
            ),
            borderRadius: BorderRadius.circular(26),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '已确认联盟佣金',
                style: TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 8),
              Text(
                '¥${summary.confirmedCommission.toStringAsFixed(2)}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 34,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '待归因佣金上限 ¥${summary.potentialCommission.toStringAsFixed(2)}',
                style: const TextStyle(color: Colors.white70),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        GridView.count(
          crossAxisCount: 2,
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.65,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          children: [
            _MetricCard(label: '商品曝光', value: '${summary.impressions}'),
            _MetricCard(label: '商品点击', value: '${summary.clicks}'),
            _MetricCard(label: '购买跳转', value: '${summary.purchaseRedirects}'),
            _MetricCard(label: '确认订单', value: '${summary.confirmedOrders}'),
          ],
        ),
        const SizedBox(height: 22),
        _RateRow(label: '点击率', value: summary.clickThroughRate),
        _RateRow(label: '购买跳转率', value: summary.purchaseRedirectRate),
        _RateRow(label: '订单转化率', value: summary.orderConversionRate),
        const SizedBox(height: 22),
        const Text(
          '联盟渠道',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 10),
        Text(
          summary.channelIds.isEmpty
              ? '尚无渠道数据'
              : summary.channelIds.join(' · '),
          style: const TextStyle(color: Color(0xFF6F6863)),
        ),
        const SizedBox(height: 18),
        const Text(
          '说明：只有联盟平台或品牌订单回传后，才计入已确认佣金。',
          style: TextStyle(
            color: Color(0xFF8B847E),
            fontSize: 12,
            height: 1.5,
          ),
        ),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(label, style: const TextStyle(color: Color(0xFF817A74))),
          const SizedBox(height: 5),
          Text(
            value,
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
          ),
        ],
      ),
    );
  }
}

class _RateRow extends StatelessWidget {
  const _RateRow({required this.label, required this.value});

  final String label;
  final double value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          Text(
            '${(value * 100).toStringAsFixed(1)}%',
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
        ],
      ),
    );
  }
}

class _RevenueError extends StatelessWidget {
  const _RevenueError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: FilledButton(
        onPressed: onRetry,
        child: const Text('收益加载失败，点击重试'),
      ),
    );
  }
}
