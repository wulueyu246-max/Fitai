class AdminAnalyticsSnapshot {
  const AdminAnalyticsSnapshot({
    required this.totalUsers,
    required this.activeUsers,
    required this.productImpressions,
    required this.productClicks,
    required this.favoriteCount,
    required this.tryOnCount,
    required this.purchaseRedirectCount,
    required this.purchaseCompletedCount,
    required this.dailyNewUsers,
    required this.dailyPhotoUploadUsers,
    required this.dailyOutfitGenerationCount,
    required this.dailyProductImpressions,
    required this.dailyProductClicks,
    required this.dailyProductDetailViews,
    required this.dailyPurchaseIntentCount,
    required this.dailyFavoriteCount,
    required this.dailyPurchaseRedirectCount,
    required this.dailyFeedbackCount,
    required this.potentialCommission,
    required this.confirmedCommission,
    required this.averageSatisfaction,
    required this.purchaseIntentRate,
    required this.noPurchaseReasons,
    required this.dataScope,
    required this.generatedAt,
  });

  final int totalUsers;
  final int activeUsers;
  final int productImpressions;
  final int productClicks;
  final int favoriteCount;
  final int tryOnCount;
  final int purchaseRedirectCount;
  final int purchaseCompletedCount;
  final int dailyNewUsers;
  final int dailyPhotoUploadUsers;
  final int dailyOutfitGenerationCount;
  final int dailyProductImpressions;
  final int dailyProductClicks;
  final int dailyProductDetailViews;
  final int dailyPurchaseIntentCount;
  final int dailyFavoriteCount;
  final int dailyPurchaseRedirectCount;
  final int dailyFeedbackCount;
  final double potentialCommission;
  final double confirmedCommission;
  final double averageSatisfaction;
  final double purchaseIntentRate;
  final Map<String, int> noPurchaseReasons;
  final String dataScope;
  final DateTime generatedAt;

  double get clickThroughRate =>
      productImpressions == 0 ? 0 : productClicks / productImpressions;

  double get tryOnRate => productClicks == 0 ? 0 : tryOnCount / productClicks;

  double get purchaseRedirectRate =>
      productClicks == 0 ? 0 : purchaseRedirectCount / productClicks;

  double get dailyClickThroughRate => dailyProductImpressions == 0
      ? 0
      : dailyProductClicks / dailyProductImpressions;

  double get dailyFavoriteRate =>
      dailyProductClicks == 0 ? 0 : dailyFavoriteCount / dailyProductClicks;

  double get dailyPurchaseRedirectRate => dailyProductClicks == 0
      ? 0
      : dailyPurchaseRedirectCount / dailyProductClicks;

  double get detailToPurchaseIntentRate => dailyProductDetailViews == 0
      ? 0
      : dailyPurchaseIntentCount / dailyProductDetailViews;
}
