import 'package:flutter/material.dart';

import '../models/fitai_pro_plan.dart';
import '../services/fitai_pro_service.dart';

class FitAIProPage extends StatefulWidget {
  const FitAIProPage({
    this.service = const FitAIProService(),
    super.key,
  });

  final FitAIProService service;

  @override
  State<FitAIProPage> createState() => _FitAIProPageState();
}

class _FitAIProPageState extends State<FitAIProPage> {
  String? _selectedPlanId;

  @override
  Widget build(BuildContext context) {
    final plans = widget.service.getPlans();
    return Scaffold(
      backgroundColor: const Color(0xFFF7F6F3),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF7F6F3),
        title: const Text('FitAI Pro'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 40),
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(26),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF17151B), Color(0xFF685875)],
                  ),
                  borderRadius: BorderRadius.circular(30),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.auto_awesome_rounded,
                      color: Color(0xFFE4CBEF),
                      size: 32,
                    ),
                    SizedBox(height: 24),
                    Text(
                      '让 AI 成为你的长期私人造型师',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 29,
                        height: 1.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 10),
                    Text(
                      '无限搭配、高级数字人、专属推荐与旅行穿搭。',
                      style: TextStyle(
                        color: Color(0xFFD9D1DC),
                        height: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 28),
              _MembershipComparison(
                free: FitAIProService.freeEntitlements,
                pro: FitAIProService.proEntitlements,
              ),
              const SizedBox(height: 28),
              for (final plan in plans) ...[
                _ProPlanCard(
                  plan: plan,
                  selected: _selectedPlanId == plan.id,
                  onTap: () => setState(() => _selectedPlanId = plan.id),
                ),
                const SizedBox(height: 14),
              ],
              const SizedBox(height: 8),
              FilledButton(
                key: const Key('fitai-pro-interest'),
                onPressed: _selectedPlanId == null
                    ? null
                    : () {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('已记录 FitAI Pro 体验意向，当前暂不扣费'),
                            behavior: SnackBarBehavior.floating,
                          ),
                        );
                      },
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF211E23),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: const Text(
                  '订阅 FitAI Pro（Demo）',
                  style: TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                '当前为会员体系页面与数据结构设计，不包含真实支付或自动续费。',
                textAlign: TextAlign.center,
                style: TextStyle(color: Color(0xFF87817B), fontSize: 11),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MembershipComparison extends StatelessWidget {
  const _MembershipComparison({required this.free, required this.pro});

  final FitAIEntitlements free;
  final FitAIEntitlements pro;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '免费用户 vs Pro用户',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 14),
          _row(
            '每日AI次数',
            '${free.dailyAiLimit}次',
            '无限',
          ),
          _row('高级分析', '基础版', _yes(pro.advancedAnalysis)),
          _row('高级试穿', '基础Mock', _yes(pro.advancedTryOn)),
          _row('私人衣橱', _yes(free.privateWardrobe), _yes(pro.privateWardrobe)),
          _row('高级数字人', '—', _yes(pro.premiumAvatar)),
        ],
      ),
    );
  }

  Widget _row(String feature, String freeValue, String proValue) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(flex: 3, child: Text(feature)),
          Expanded(
            flex: 2,
            child: Text(
              freeValue,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF77706B)),
            ),
          ),
          Expanded(
            flex: 2,
            child: Text(
              proValue,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF695777),
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _yes(bool value) => value ? '支持' : '—';
}

class _ProPlanCard extends StatelessWidget {
  const _ProPlanCard({
    required this.plan,
    required this.selected,
    required this.onTap,
  });

  final FitAIProPlan plan;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(23),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(23),
          border: Border.all(
            color: selected ? const Color(0xFF695777) : const Color(0xFFE8E3DE),
            width: selected ? 2 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    plan.name,
                    style: const TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                if (plan.recommended)
                  const Chip(
                    visualDensity: VisualDensity.compact,
                    label: Text('推荐'),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: plan.priceLabel,
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  TextSpan(
                    text: plan.billingLabel,
                    style: const TextStyle(color: Color(0xFF827B75)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            for (final benefit in plan.benefits)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    const Icon(
                      Icons.check_circle_rounded,
                      size: 17,
                      color: Color(0xFF695777),
                    ),
                    const SizedBox(width: 8),
                    Text(benefit),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
