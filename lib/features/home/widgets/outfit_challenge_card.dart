import 'package:flutter/material.dart';

import '../models/fashion_feed.dart';

class OutfitChallengeCard extends StatelessWidget {
  const OutfitChallengeCard({
    required this.challenge,
    required this.onJoin,
    super.key,
  });

  final OutfitChallenge challenge;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('seven-day-outfit-challenge'),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFF0E8F4), Color(0xFFE6EDF4)],
        ),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: const Color(0xFFE0D8E5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(
                  color: Color(0xFF211D24),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.local_fire_department_rounded,
                  color: Color(0xFFFFD49D),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      challenge.title,
                      style: const TextStyle(
                        color: Color(0xFF211E23),
                        fontSize: 19,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${challenge.completedDays}/${challenge.totalDays} 天已参与',
                      style: const TextStyle(
                        color: Color(0xFF73687B),
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            challenge.description,
            style: const TextStyle(
              color: Color(0xFF645D67),
              height: 1.5,
              fontSize: 12.5,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              for (var index = 0; index < challenge.totalDays; index++) ...[
                Expanded(
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 260),
                    height: 7,
                    decoration: BoxDecoration(
                      color: index < challenge.completedDays
                          ? const Color(0xFF685875)
                          : const Color(0xFFCFC7D3),
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                ),
                if (index < challenge.totalDays - 1) const SizedBox(width: 5),
              ],
            ],
          ),
          const SizedBox(height: 17),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              key: const Key('join-outfit-challenge'),
              onPressed: onJoin,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF211D24),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              icon: Icon(
                challenge.checkedInToday
                    ? Icons.check_circle_rounded
                    : Icons.auto_awesome_rounded,
                size: 18,
              ),
              label: Text(
                challenge.checkedInToday ? '继续探索今日Look' : '生成今日Look',
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
