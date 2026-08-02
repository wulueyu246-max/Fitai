enum RecommendationFeedbackAction {
  click,
  favorite,
  tryOn,
  purchase,
}

class RecommendationFeedback {
  const RecommendationFeedback({
    required this.id,
    required this.userId,
    required this.action,
    required this.createdAt,
    this.productId,
    this.outfitPlanId,
    this.source = 'unknown',
  });

  factory RecommendationFeedback.fromJson(Map<String, dynamic> json) {
    return RecommendationFeedback(
      id: json['id'] as String,
      userId: json['userId'] as String,
      action: RecommendationFeedbackAction.values.firstWhere(
        (value) => value.name == json['action'],
        orElse: () => RecommendationFeedbackAction.click,
      ),
      productId: json['productId'] as String?,
      outfitPlanId: json['outfitPlanId'] as String?,
      source: json['source'] as String? ?? 'unknown',
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String userId;
  final RecommendationFeedbackAction action;
  final String? productId;
  final String? outfitPlanId;
  final String source;
  final DateTime createdAt;

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'userId': userId,
      'action': action.name,
      'productId': productId,
      'outfitPlanId': outfitPlanId,
      'source': source,
      'createdAt': createdAt.toIso8601String(),
    };
  }
}
