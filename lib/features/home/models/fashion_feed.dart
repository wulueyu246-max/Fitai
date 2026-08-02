import '../../../models/daily_outfit.dart';
import '../../../models/outfit_plan.dart';
import '../../../models/outfit_post.dart';
import '../../../models/product.dart';
import 'daily_fashion_context.dart';

class FashionScene {
  const FashionScene({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.imageAsset,
  });

  final String id;
  final String title;
  final String subtitle;
  final String imageAsset;
}

class OutfitChallenge {
  const OutfitChallenge({
    required this.id,
    required this.title,
    required this.description,
    required this.totalDays,
    required this.completedDays,
    required this.checkedInToday,
  });

  final String id;
  final String title;
  final String description;
  final int totalDays;
  final int completedDays;
  final bool checkedInToday;

  double get progress =>
      totalDays == 0 ? 0 : completedDays.clamp(0, totalDays) / totalDays;

  OutfitChallenge copyWith({
    int? completedDays,
    bool? checkedInToday,
  }) {
    return OutfitChallenge(
      id: id,
      title: title,
      description: description,
      totalDays: totalDays,
      completedDays: completedDays ?? this.completedDays,
      checkedInToday: checkedInToday ?? this.checkedInToday,
    );
  }
}

class FashionFeed {
  const FashionFeed({
    required this.dailyOutfit,
    required this.scenes,
    required this.hotLooks,
    required this.communityLooks,
    required this.products,
    required this.challenge,
    required this.personalizationSummary,
  });

  final DailyOutfit dailyOutfit;
  final List<FashionScene> scenes;
  final List<OutfitPost> hotLooks;
  final List<OutfitPost> communityLooks;
  final List<Product> products;
  final OutfitChallenge challenge;
  final String personalizationSummary;

  DailyFashionContext get context => dailyOutfit.context;
  String get scene => dailyOutfit.scene;
  OutfitPlan get dailyPlan => dailyOutfit.plan;
  String get dailyReason => dailyOutfit.aiReason;
}
