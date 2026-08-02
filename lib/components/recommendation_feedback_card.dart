import 'package:flutter/material.dart';

import '../models/feedback_event.dart';

class RecommendationFeedbackInput {
  const RecommendationFeedbackInput({
    required this.satisfaction,
    required this.rating,
    required this.willingToBuy,
    this.noPurchaseReason,
  });

  final int satisfaction;
  final FeedbackRating rating;
  bool get likedOutfit => rating == FeedbackRating.like;
  final bool willingToBuy;
  final String? noPurchaseReason;
}

class RecommendationFeedbackCard extends StatefulWidget {
  const RecommendationFeedbackCard({
    required this.onSubmit,
    this.submitted = false,
    super.key,
  });

  final Future<void> Function(RecommendationFeedbackInput input) onSubmit;
  final bool submitted;

  @override
  State<RecommendationFeedbackCard> createState() =>
      _RecommendationFeedbackCardState();
}

class _RecommendationFeedbackCardState
    extends State<RecommendationFeedbackCard> {
  int? _satisfaction;
  FeedbackRating? _rating;
  bool? _willingToBuy;
  String? _reason;
  bool _submitting = false;

  static const _reasons = [
    '价格太高',
    '风格不喜欢',
    '不适合自己',
    '没有购买需求',
  ];

  bool get _complete {
    return _satisfaction != null &&
        _rating != null &&
        _willingToBuy != null &&
        (_willingToBuy == true || _reason != null);
  }

  Future<void> _submit() async {
    if (!_complete || _submitting) {
      return;
    }
    setState(() => _submitting = true);
    try {
      await widget.onSubmit(
        RecommendationFeedbackInput(
          satisfaction: _satisfaction!,
          rating: _rating!,
          willingToBuy: _willingToBuy!,
          noPurchaseReason: _reason,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.submitted) {
      return Container(
        key: const Key('recommendation-feedback-submitted'),
        width: double.infinity,
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: const Color(0xFFE8F2EC),
          borderRadius: BorderRadius.circular(20),
        ),
        child: const Row(
          children: [
            Icon(Icons.check_circle_rounded, color: Color(0xFF3E6D52)),
            SizedBox(width: 10),
            Expanded(child: Text('感谢反馈，下一次推荐会更懂你。')),
          ],
        ),
      );
    }

    return Container(
      key: const Key('recommendation-feedback-card'),
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE7E2DC)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '这套推荐适合你吗？',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 5),
          const Text(
            '30秒反馈，帮助树皮优化下一次搭配',
            style: TextStyle(color: Color(0xFF7B746F)),
          ),
          const SizedBox(height: 18),
          const Text('推荐满意度'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              for (var score = 1; score <= 5; score++)
                ChoiceChip(
                  key: Key('feedback-score-$score'),
                  label: Text('$score'),
                  selected: _satisfaction == score,
                  onSelected: (_) => setState(() => _satisfaction = score),
                ),
            ],
          ),
          const SizedBox(height: 18),
          const Text('你对这套搭配的评价'),
          const SizedBox(height: 8),
          _RatingQuestion(
            value: _rating,
            onChanged: (value) => setState(() => _rating = value),
          ),
          const SizedBox(height: 16),
          _BinaryQuestion(
            title: '你愿意购买其中的商品吗？',
            value: _willingToBuy,
            yesKey: const Key('feedback-buy-yes'),
            noKey: const Key('feedback-buy-no'),
            onChanged: (value) {
              setState(() {
                _willingToBuy = value;
                if (value) {
                  _reason = null;
                }
              });
            },
          ),
          if (_willingToBuy == false) ...[
            const SizedBox(height: 16),
            const Text('为什么暂时不购买？'),
            const SizedBox(height: 8),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                for (final reason in _reasons)
                  ChoiceChip(
                    key: Key('feedback-reason-$reason'),
                    label: Text(reason),
                    selected: _reason == reason,
                    onSelected: (_) => setState(() => _reason = reason),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              key: const Key('submit-recommendation-feedback'),
              onPressed: _complete && !_submitting ? _submit : null,
              child: Text(_submitting ? '提交中...' : '提交反馈'),
            ),
          ),
        ],
      ),
    );
  }
}

class _RatingQuestion extends StatelessWidget {
  const _RatingQuestion({required this.value, required this.onChanged});

  final FeedbackRating? value;
  final ValueChanged<FeedbackRating> onChanged;

  @override
  Widget build(BuildContext context) {
    const options = [
      (FeedbackRating.like, '喜欢', Key('feedback-like-yes')),
      (FeedbackRating.neutral, '一般', Key('feedback-like-neutral')),
      (FeedbackRating.dislike, '不喜欢', Key('feedback-like-no')),
    ];
    return Row(
      children: [
        for (var index = 0; index < options.length; index++) ...[
          if (index > 0) const SizedBox(width: 8),
          Expanded(
            child: ChoiceChip(
              key: options[index].$3,
              label: SizedBox(
                width: double.infinity,
                child: Text(options[index].$2, textAlign: TextAlign.center),
              ),
              selected: value == options[index].$1,
              onSelected: (_) => onChanged(options[index].$1),
            ),
          ),
        ],
      ],
    );
  }
}

class _BinaryQuestion extends StatelessWidget {
  const _BinaryQuestion({
    required this.title,
    required this.value,
    required this.yesKey,
    required this.noKey,
    required this.onChanged,
  });

  final String title;
  final bool? value;
  final Key yesKey;
  final Key noKey;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: ChoiceChip(
                key: yesKey,
                label: const SizedBox(
                  width: double.infinity,
                  child: Text('愿意 / 喜欢', textAlign: TextAlign.center),
                ),
                selected: value == true,
                onSelected: (_) => onChanged(true),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: ChoiceChip(
                key: noKey,
                label: const SizedBox(
                  width: double.infinity,
                  child: Text('暂不 / 不喜欢', textAlign: TextAlign.center),
                ),
                selected: value == false,
                onSelected: (_) => onChanged(false),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
