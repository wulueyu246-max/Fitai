class AnalyticsEvent {
  const AnalyticsEvent({
    required this.id,
    required this.name,
    required this.userId,
    required this.createdAt,
    this.properties = const {},
  });

  factory AnalyticsEvent.fromJson(Map<String, dynamic> json) {
    return AnalyticsEvent(
      id: json['id'] as String,
      name: json['name'] as String,
      userId: json['userId'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      properties: Map<String, String>.from(
        json['properties'] as Map<dynamic, dynamic>? ?? const {},
      ),
    );
  }

  final String id;
  final String name;
  final String userId;
  final DateTime createdAt;
  final Map<String, String> properties;

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'userId': userId,
      'createdAt': createdAt.toIso8601String(),
      'properties': properties,
    };
  }
}

class AnalyticsDashboard {
  const AnalyticsDashboard({
    required this.dailyActiveUsers,
    required this.recommendationClickRate,
    required this.productConversionRate,
    required this.tryOnCount,
    required this.tryOnRate,
    required this.averageDwellSeconds,
    required this.popularProductIds,
    required this.dailyNewUsers,
    required this.dailyPhotoUploadUsers,
    required this.dailyOutfitGenerationCount,
    required this.dailyProductImpressions,
    required this.dailyProductClicks,
    required this.dailyProductDetailViews,
    required this.dailyPurchaseIntents,
    required this.dailyFavorites,
    required this.dailyPurchaseRedirects,
  });

  final int dailyActiveUsers;
  final double recommendationClickRate;
  final double productConversionRate;
  final int tryOnCount;
  final double tryOnRate;
  final double averageDwellSeconds;
  final List<String> popularProductIds;
  final int dailyNewUsers;
  final int dailyPhotoUploadUsers;
  final int dailyOutfitGenerationCount;
  final int dailyProductImpressions;
  final int dailyProductClicks;
  final int dailyProductDetailViews;
  final int dailyPurchaseIntents;
  final int dailyFavorites;
  final int dailyPurchaseRedirects;
}
