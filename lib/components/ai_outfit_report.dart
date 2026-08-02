import 'package:flutter/material.dart';

import '../models/outfit_analysis.dart';
import '../models/body_profile.dart';

class AiOutfitReport extends StatelessWidget {
  const AiOutfitReport({
    required this.analysis,
    required this.profile,
    super.key,
  });

  final OutfitAnalysis analysis;
  final BodyProfile profile;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('ai-outfit-report'),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(26),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0C1D1814),
            blurRadius: 18,
            offset: Offset(0, 7),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: const BoxDecoration(
                  color: Color(0xFFECE7F0),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.analytics_outlined,
                  color: Color(0xFF675874),
                ),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '身材分析',
                      style: TextStyle(
                        color: Color(0xFF201E1C),
                        fontSize: 21,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 3),
                    Text(
                      '关键比例决定版型与视觉重心',
                      style: TextStyle(
                        color: Color(0xFF817B75),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Wrap(
            spacing: 9,
            runSpacing: 9,
            children: [
              _ProfileMetric(
                label: '身高',
                value: '${profile.height.toStringAsFixed(0)} cm',
              ),
              _ProfileMetric(
                label: '体重',
                value: '${profile.weight.toStringAsFixed(0)} kg',
              ),
              _ProfileMetric(label: '身型', value: profile.bodyType),
              _ProfileMetric(label: '肩宽比例', value: profile.shoulderRatio),
              _ProfileMetric(label: '腿型比例', value: profile.legRatio),
            ],
          ),
          const SizedBox(height: 20),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(15),
            decoration: BoxDecoration(
              color: const Color(0xFFEDE9F0),
              borderRadius: BorderRadius.circular(17),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '风格定位',
                  style: TextStyle(
                    color: Color(0xFF695A78),
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  analysis.style,
                  style: const TextStyle(
                    color: Color(0xFF2A262D),
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  analysis.bodyAnalysis,
                  style: const TextStyle(
                    color: Color(0xFF625D64),
                    fontSize: 12.5,
                    height: 1.5,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            '搭配建议',
            style: TextStyle(
              color: Color(0xFF282522),
              fontSize: 16,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 12),
          _AdviceTile(label: '上衣', content: analysis.top),
          _AdviceTile(label: '裤子', content: analysis.bottom),
          _AdviceTile(label: '鞋履', content: analysis.shoes),
          _AdviceTile(label: '配饰', content: analysis.accessories),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFF222025),
              borderRadius: BorderRadius.circular(17),
            ),
            child: Text(
              analysis.suggestion,
              style: const TextStyle(
                color: Color(0xFFE9E4EB),
                fontSize: 13,
                height: 1.55,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileMetric extends StatelessWidget {
  const _ProfileMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 105),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF5F3F0),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: Color(0xFF8A837D), fontSize: 10.5),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              color: Color(0xFF292623),
              fontSize: 13,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _AdviceTile extends StatelessWidget {
  const _AdviceTile({required this.label, required this.content});

  final String label;
  final String content;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 9),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF5F2F6),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 38,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF6D5C79),
                fontSize: 12,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          Expanded(
            child: Text(
              content,
              style: const TextStyle(
                color: Color(0xFF565057),
                fontSize: 12.5,
                height: 1.5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
