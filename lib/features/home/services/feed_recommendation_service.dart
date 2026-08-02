import '../../../data/mock_outfit_post_database.dart';
import '../../../models/fashion_profile.dart';
import '../../../models/product.dart';
import '../../../models/recommendation_feedback.dart';
import '../../../models/user_profile.dart';
import '../../../models/user_fashion_profile.dart';
import '../../../services/daily_outfit_service.dart';
import '../../../services/recommendation_engine.dart';
import '../models/daily_fashion_context.dart';
import '../models/fashion_feed.dart';

class FeedRecommendationInput {
  const FeedRecommendationInput({
    required this.userProfile,
    required this.fashionProfile,
    required this.aiBodyAnalysis,
    required this.browsingRecords,
    required this.favoriteProductIds,
    required this.tryOnProductIds,
    required this.feedback,
    required this.context,
    required this.challenge,
    required this.scene,
    this.userFashionProfile,
    this.query = '',
    this.productCatalog,
  });

  final UserProfile userProfile;
  final FashionProfile fashionProfile;
  final String aiBodyAnalysis;
  final List<String> browsingRecords;
  final Set<String> favoriteProductIds;
  final List<String> tryOnProductIds;
  final List<RecommendationFeedback> feedback;
  final DailyFashionContext context;
  final OutfitChallenge challenge;
  final String scene;
  final UserFashionProfile? userFashionProfile;
  final String query;
  final List<Product>? productCatalog;
}

class FeedRecommendationService {
  const FeedRecommendationService({
    this.engine = const RecommendationEngine(),
    this.dailyOutfitService = const LocalDailyOutfitService(),
  });

  final RecommendationEngine engine;
  final DailyOutfitService dailyOutfitService;

  FashionFeed recommend(FeedRecommendationInput input) {
    final profile = input.userProfile.copyWith(
      stylePreference: {
        ...input.fashionProfile.likedStyles,
        ...input.userProfile.stylePreference,
      }.toList(growable: false),
      favoriteColors: {
        ...input.fashionProfile.commonColors,
        ...input.userProfile.favoriteColors,
      }.toList(growable: false),
      favoriteBrands: {
        ...input.fashionProfile.likedBrands,
        ...input.userProfile.favoriteBrands,
      }.toList(growable: false),
      purchaseHistory: {
        ...input.fashionProfile.purchaseHistory,
        ...input.userProfile.purchaseHistory,
      }.toList(growable: false),
      tryOnHistory: {
        ...input.userProfile.tryOnHistory,
        ...input.tryOnProductIds,
      }.toList(growable: false),
    );
    final result = engine.generate(
      input: RecommendationEngineInput(
        userProfile: profile,
        aiBodyAnalysis: input.aiBodyAnalysis,
        browsingRecords: input.browsingRecords,
        favoriteProductIds: input.favoriteProductIds,
        feedback: input.feedback,
        scene: input.scene,
        query: input.query,
        weather: input.context.condition,
        temperature: input.context.temperature,
        humidity: input.context.humidity,
        budgetMin: input.fashionProfile.budgetMin,
        budgetMax: input.fashionProfile.budgetMax,
        referenceTime: DateTime(
          input.context.updatedAt.year,
          input.context.updatedAt.month,
          input.context.updatedAt.day,
        ),
      ),
      postCatalog: MockOutfitPostDatabase.posts,
      productCatalog: input.productCatalog,
      productLimit: 10,
    );
    final products = _rankByFashionProfile(
      result.products,
      input.fashionProfile,
      input.userFashionProfile,
    );
    final dailyPlan = engine.recommendationService.buildOutfitPlan(
      products: products,
      style: input.fashionProfile.likedStyles.take(2).join(''),
      scene: input.scene,
      createdTime: DateTime(
        input.context.updatedAt.year,
        input.context.updatedAt.month,
        input.context.updatedAt.day,
      ),
    );
    final weatherAdvice = _weatherAdvice(
      input.context.temperature,
      input.context.condition,
      input.context.humidity,
    );
    final reason = '${input.context.city} ${input.context.temperatureLabel} '
        '${input.context.condition}，$weatherAdvice'
        '；${dailyPlan.reason}';
    final dailyOutfit = dailyOutfitService.generate(
      context: input.context,
      scene: input.scene,
      plan: dailyPlan,
      aiReason: reason,
    );
    final communityLooks = [...MockOutfitPostDatabase.posts]
      ..sort((left, right) => right.likes.compareTo(left.likes));

    return FashionFeed(
      dailyOutfit: dailyOutfit,
      scenes: scenes,
      hotLooks: result.homePosts,
      communityLooks: List.unmodifiable(communityLooks),
      products: products,
      challenge: input.challenge,
      personalizationSummary: result.personalizationSummary,
    );
  }

  List<Product> _rankByFashionProfile(
    List<Product> products,
    FashionProfile profile,
    UserFashionProfile? userFashionProfile,
  ) {
    final indexed = products.indexed.toList()
      ..sort((left, right) {
        int score((int, Product) item) {
          final product = item.$2;
          var value = (products.length - item.$1) * 10;
          if (profile.isWithinBudget(product.price)) {
            value += 120;
          } else {
            value -= 30;
          }
          if (profile.likedBrands.any(
            (brand) => brand.toLowerCase() == product.brand.toLowerCase(),
          )) {
            value += 12;
          }
          if (profile.likedStyles.any(product.style.contains)) {
            value += 8;
          }
          if (profile.commonColors.any(product.color.contains)) {
            value += 6;
          }
          if (userFashionProfile != null) {
            if (userFashionProfile.favoriteBrands.any(
              (brand) => brand.toLowerCase() == product.brand.toLowerCase(),
            )) {
              value += 18;
            }
            if (userFashionProfile.favoriteColors.any(product.color.contains)) {
              value += 10;
            }
            if (userFashionProfile.clickHistory.contains(product.id)) {
              value += 16;
            }
            if (userFashionProfile.isWithinBudget(product.price)) {
              value += 24;
            }
          }
          return value;
        }

        final comparison = score(right).compareTo(score(left));
        return comparison != 0 ? comparison : left.$2.id.compareTo(right.$2.id);
      });
    return List<Product>.unmodifiable(indexed.map((item) => item.$2));
  }

  static const scenes = [
    FashionScene(
      id: 'commute',
      title: '通勤',
      subtitle: '清晰利落',
      imageAsset: 'assets/images/home/business_commute.jpg',
    ),
    FashionScene(
      id: 'date',
      title: '约会',
      subtitle: '柔和氛围',
      imageAsset: 'assets/images/home/date_night.jpg',
    ),
    FashionScene(
      id: 'travel',
      title: '旅行',
      subtitle: '轻盈舒适',
      imageAsset: 'assets/images/home/summer_clean.jpg',
    ),
    FashionScene(
      id: 'sport',
      title: '运动',
      subtitle: '功能街头',
      imageAsset: 'assets/images/home/street_graphite.jpg',
    ),
    FashionScene(
      id: 'interview',
      title: '面试',
      subtitle: '可信专业',
      imageAsset: 'assets/images/home/minimal_monochrome.jpg',
    ),
  ];

  String _weatherAdvice(
    int temperature,
    String condition,
    double humidity,
  ) {
    if (condition.contains('雨')) {
      return '优先防泼水外套、包裹性鞋履和不易吸水材质';
    }
    if (temperature >= 30) {
      return humidity >= 75 ? '高温高湿，优先短袖、透气或速干面料' : '优先短袖、透气面料与浅色单品';
    }
    if (temperature >= 22) {
      return '适合轻薄上衣与利落长裤';
    }
    if (temperature >= 12) {
      return '建议加入轻外套形成层次';
    }
    return '建议使用保暖外套和厚实面料';
  }
}
