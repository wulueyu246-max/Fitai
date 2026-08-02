class ConversionFunnel {
  const ConversionFunnel({
    required this.impressions,
    required this.clicks,
    required this.favorites,
    required this.addedToTryOn,
    required this.purchaseRedirects,
    required this.purchasesCompleted,
  });

  final int impressions;
  final int clicks;
  final int favorites;
  final int addedToTryOn;
  final int purchaseRedirects;
  final int purchasesCompleted;

  double get clickThroughRate => _rate(clicks, impressions);
  double get favoriteRate => _rate(favorites, clicks);
  double get tryOnRate => _rate(addedToTryOn, clicks);
  double get purchaseRedirectRate => _rate(purchaseRedirects, clicks);
  double get purchaseCompletionRate =>
      _rate(purchasesCompleted, purchaseRedirects);
  double get endToEndConversionRate => _rate(purchasesCompleted, impressions);

  static double _rate(int numerator, int denominator) {
    return denominator == 0 ? 0 : numerator / denominator;
  }
}
