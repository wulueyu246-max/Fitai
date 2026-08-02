enum FeedbackRating { like, neutral, dislike }

class FeedbackEvent {
  const FeedbackEvent({
    required this.id,
    required this.userId,
    required this.outfitPlanId,
    required this.scene,
    required this.satisfaction,
    required this.likedOutfit,
    required this.rating,
    required this.willingToBuy,
    required this.createdAt,
    this.noPurchaseReason,
  });

  factory FeedbackEvent.fromJson(Map<String, dynamic> json) {
    return FeedbackEvent(
      id: json['id'] as String,
      userId: json['userId'] as String,
      outfitPlanId: json['outfitPlanId'] as String,
      scene: json['scene'] as String? ?? '未知',
      satisfaction: (json['satisfaction'] as num).toInt(),
      likedOutfit: json['likedOutfit'] as bool,
      rating: FeedbackRating.values.firstWhere(
        (value) => value.name == json['rating'],
        orElse: () => json['likedOutfit'] == true
            ? FeedbackRating.like
            : FeedbackRating.dislike,
      ),
      willingToBuy: json['willingToBuy'] as bool,
      noPurchaseReason: json['noPurchaseReason'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String userId;
  final String outfitPlanId;
  final String scene;
  final int satisfaction;
  final bool likedOutfit;
  final FeedbackRating rating;
  final bool willingToBuy;
  final String? noPurchaseReason;
  final DateTime createdAt;

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'userId': userId,
      'outfitPlanId': outfitPlanId,
      'scene': scene,
      'satisfaction': satisfaction,
      'likedOutfit': likedOutfit,
      'rating': rating.name,
      'willingToBuy': willingToBuy,
      'noPurchaseReason': noPurchaseReason,
      'createdAt': createdAt.toIso8601String(),
    };
  }
}

class FeedbackDailySummary {
  const FeedbackDailySummary({
    required this.total,
    required this.averageSatisfaction,
    required this.likedRate,
    required this.purchaseIntentRate,
    required this.noPurchaseReasons,
  });

  final int total;
  final double averageSatisfaction;
  final double likedRate;
  final double purchaseIntentRate;
  final Map<String, int> noPurchaseReasons;
}
