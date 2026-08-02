import 'package:flutter/material.dart';

import '../models/brand_partner.dart';
import '../services/brand_partner_service.dart';

class BrandPartnerCenterPage extends StatelessWidget {
  const BrandPartnerCenterPage({
    this.service = const MockBrandPartnerService(),
    super.key,
  });

  final BrandPartnerService service;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F6F3),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF7F6F3),
        title: const Text('品牌合作'),
      ),
      body: FutureBuilder<List<BrandPartner>>(
        future: service.getPartners(),
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final partners = snapshot.data ?? const [];
          if (snapshot.hasError || partners.isEmpty) {
            return const Center(child: Text('暂无品牌合作信息'));
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
            children: [
              const Text(
                'FitAI 品牌增长中心',
                style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 7),
              const Text(
                '商品接入、AI推荐、虚拟试穿与联盟佣金合作',
                style: TextStyle(color: Color(0xFF746D67)),
              ),
              const SizedBox(height: 22),
              for (final partner in partners) ...[
                _PartnerCard(
                  partner: partner,
                  onSubmit: () => _submit(context, partner),
                ),
                const SizedBox(height: 12),
              ],
            ],
          );
        },
      ),
    );
  }

  Future<void> _submit(BuildContext context, BrandPartner partner) async {
    await service.submitCooperationIntent(
      brandId: partner.brandId,
      contact: 'commercial-test@fitai.local',
    );
    if (!context.mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('${partner.brandName} 合作意向已记录'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

class _PartnerCard extends StatelessWidget {
  const _PartnerCard({
    required this.partner,
    required this.onSubmit,
  });

  final BrandPartner partner;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final commission = partner.commissionRate;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  partner.brandName,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              _StatusChip(status: partner.status),
            ],
          ),
          const SizedBox(height: 7),
          Text(
            partner.campaignTitle,
            style: const TextStyle(color: Color(0xFF6F6863)),
          ),
          if (commission != null) ...[
            const SizedBox(height: 8),
            Text(
              '参考佣金 ${(commission * 100).toStringAsFixed(1)}%',
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              key: Key('submit-partner-${partner.brandId}'),
              onPressed: onSubmit,
              child: const Text('提交合作意向'),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final BrandPartnerStatus status;

  @override
  Widget build(BuildContext context) {
    final label = switch (status) {
      BrandPartnerStatus.active => '已合作',
      BrandPartnerStatus.mockConnected => '测试接入',
      BrandPartnerStatus.prospect => '洽谈中',
      BrandPartnerStatus.paused => '已暂停',
    };
    return Chip(
      label: Text(label),
      visualDensity: VisualDensity.compact,
    );
  }
}
