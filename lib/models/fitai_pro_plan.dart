class FitAIProPlan {
  const FitAIProPlan({
    required this.id,
    required this.name,
    required this.priceLabel,
    required this.billingLabel,
    required this.benefits,
    this.recommended = false,
  });

  final String id;
  final String name;
  final String priceLabel;
  final String billingLabel;
  final List<String> benefits;
  final bool recommended;
}

class FitAIProMembership {
  const FitAIProMembership({
    required this.active,
    this.planId,
    this.expiresAt,
  });

  final bool active;
  final String? planId;
  final DateTime? expiresAt;
}

enum FitAIMemberTier { free, pro }

enum FitAIProFeature {
  dailyAnalysis,
  advancedAnalysis,
  advancedTryOn,
  privateWardrobe,
  premiumAvatar,
}

class FitAIEntitlements {
  const FitAIEntitlements({
    required this.tier,
    required this.dailyAiLimit,
    required this.advancedAnalysis,
    required this.advancedTryOn,
    required this.privateWardrobe,
    required this.premiumAvatar,
  });

  final FitAIMemberTier tier;
  final int dailyAiLimit;
  final bool advancedAnalysis;
  final bool advancedTryOn;
  final bool privateWardrobe;
  final bool premiumAvatar;

  bool canUse(FitAIProFeature feature) {
    return switch (feature) {
      FitAIProFeature.dailyAnalysis => dailyAiLimit > 0,
      FitAIProFeature.advancedAnalysis => advancedAnalysis,
      FitAIProFeature.advancedTryOn => advancedTryOn,
      FitAIProFeature.privateWardrobe => privateWardrobe,
      FitAIProFeature.premiumAvatar => premiumAvatar,
    };
  }
}
