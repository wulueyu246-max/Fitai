import '../models/outfit_plan.dart';
import '../models/outfit_post.dart';
import '../models/product.dart';
import '../models/recommendation_feedback.dart';
import '../models/user_preference.dart';
import '../models/user_profile.dart';
import 'recommendation_service.dart';

class RecommendationEngineInput {
  const RecommendationEngineInput({
    required this.userProfile,
    required this.aiBodyAnalysis,
    required this.browsingRecords,
    required this.favoriteProductIds,
    required this.feedback,
    required this.scene,
    this.query = '',
    this.weather = '',
    this.temperature,
    this.humidity,
    this.budgetMin = 0,
    this.budgetMax = double.infinity,
    this.referenceTime,
  });

  final UserProfile userProfile;
  final String aiBodyAnalysis;
  final List<String> browsingRecords;
  final Set<String> favoriteProductIds;
  final List<RecommendationFeedback> feedback;
  final String scene;
  final String query;
  final String weather;
  final int? temperature;
  final double? humidity;
  final double budgetMin;
  final double budgetMax;
  final DateTime? referenceTime;
}

class RecommendationEngineResult {
  const RecommendationEngineResult({
    required this.products,
    required this.outfitPlan,
    required this.homePosts,
    required this.personalizationSummary,
  });

  final List<Product> products;
  final OutfitPlan outfitPlan;
  final List<OutfitPost> homePosts;
  final String personalizationSummary;
}

/// V1 本地推荐编排层。
///
/// 页面只消费一个结果对象；未来接入排序模型时，只需替换此实现，
/// 无需修改首页、商品卡片或试穿流程。
class RecommendationEngine {
  const RecommendationEngine({
    this.recommendationService = const RecommendationService(),
  });

  final RecommendationService recommendationService;

  RecommendationEngineResult generate({
    required RecommendationEngineInput input,
    required List<OutfitPost> postCatalog,
    List<Product>? productCatalog,
    int productLimit = 12,
  }) {
    final preference = _buildPreference(input);
    final baseProducts = recommendationService.recommendProducts(
      height: input.userProfile.height,
      weight: input.userProfile.weight,
      bodyType: input.userProfile.bodyType,
      shoulderRatio: input.aiBodyAnalysis,
      legRatio: input.aiBodyAnalysis,
      style: input.userProfile.stylePreference.join(' '),
      scene: input.scene,
      preference: preference,
      limit: productLimit,
      catalog: productCatalog,
    );
    final products = _rankByBehavior(baseProducts, input);
    final posts = recommendationService.recommendPosts(
      posts: postCatalog,
      preference: preference,
      channel: input.scene,
      query: input.query,
    );
    final plan = recommendationService.buildOutfitPlan(
      products: products,
      style: input.userProfile.stylePreference.take(2).join(''),
      scene: input.scene,
      createdTime: input.referenceTime,
      catalog: productCatalog,
    );

    return RecommendationEngineResult(
      products: List<Product>.unmodifiable(products),
      outfitPlan: plan,
      homePosts: posts,
      personalizationSummary: _summary(input),
    );
  }

  UserPreference _buildPreference(RecommendationEngineInput input) {
    return UserPreference(
      likedStyles: input.userProfile.stylePreference,
      likedColors: input.userProfile.favoriteColors,
      bodyFeatures: [
        input.userProfile.bodyType,
        if (input.aiBodyAnalysis.trim().isNotEmpty) input.aiBodyAnalysis,
      ],
      purchaseHistory: input.userProfile.purchaseHistory,
      browsingHistory: input.browsingRecords,
    );
  }

  List<Product> _rankByBehavior(
    List<Product> products,
    RecommendationEngineInput input,
  ) {
    final recentInteractions = <String, int>{};
    for (final item in input.feedback) {
      final productId = item.productId;
      if (productId == null) {
        continue;
      }
      recentInteractions[productId] =
          (recentInteractions[productId] ?? 0) + _weight(item.action);
    }

    final indexed = products.indexed.toList()
      ..sort((left, right) {
        int score((int, Product) item) {
          final product = item.$2;
          var value = (products.length - item.$1) * 10;
          if (input.userProfile.favoriteBrands.contains(product.brand)) {
            value += 12;
          }
          if (input.favoriteProductIds.contains(product.id)) {
            value += 6;
          }
          if (input.userProfile.tryOnHistory.contains(product.id)) {
            value += 4;
          }
          if (product.numericPrice >= input.budgetMin &&
              product.numericPrice <= input.budgetMax) {
            value += 18;
          } else {
            value -= 8;
          }
          value += _weatherScore(
            product,
            input.temperature,
            input.weather,
            input.humidity,
          );
          value += recentInteractions[product.id] ?? 0;
          return value;
        }

        final comparison = score(right).compareTo(score(left));
        return comparison != 0 ? comparison : left.$2.id.compareTo(right.$2.id);
      });
    return indexed.map((item) => item.$2).toList(growable: false);
  }

  int _weight(RecommendationFeedbackAction action) {
    return switch (action) {
      RecommendationFeedbackAction.click => 1,
      RecommendationFeedbackAction.favorite => 4,
      RecommendationFeedbackAction.tryOn => 7,
      RecommendationFeedbackAction.purchase => 12,
    };
  }

  int _weatherScore(
    Product product,
    int? temperature,
    String weather,
    double? humidity,
  ) {
    if (temperature == null) {
      return 0;
    }
    final productText = '${product.name} ${product.material} '
            '${product.description} ${product.style}'
        .toLowerCase();
    var score = 0;
    if (weather.contains('雨')) {
      if (product.category == ProductCategory.outerwear) score += 12;
      if (product.category == ProductCategory.shoes) score += 10;
      if (productText.contains('防风') ||
          productText.contains('机能') ||
          productText.contains('橡胶')) {
        score += 10;
      }
    }
    if (temperature >= 28) {
      score += product.season.contains('夏') ||
              product.material.contains('棉') ||
              productText.contains('airism') ||
              productText.contains('速干')
          ? 8
          : 0;
    } else if (temperature <= 12) {
      score += product.category == ProductCategory.outerwear ||
              product.season.contains('冬') ||
              product.material.contains('羊毛')
          ? 8
          : 0;
    } else if (product.season.contains('四季')) {
      score += 4;
    }
    if ((humidity ?? 0) >= 75 &&
        (productText.contains('透气') || productText.contains('速干'))) {
      score += 6;
    }
    return score;
  }

  String _summary(RecommendationEngineInput input) {
    final brands = input.userProfile.favoriteBrands.take(2).join('、');
    final interactions = input.feedback.length;
    final weather = input.weather.trim().isEmpty ? '' : '、${input.weather}天气';
    final budget = input.budgetMax.isFinite
        ? '、¥${input.budgetMin.toStringAsFixed(0)}-'
            '¥${input.budgetMax.toStringAsFixed(0)}预算'
        : '';
    return '已结合${input.userProfile.bodyType}、'
        '${input.userProfile.stylePreference.take(2).join(' × ')}偏好'
        '${brands.isEmpty ? '' : '、$brands 品牌倾向'}'
        '$weather$budget'
        '和 $interactions 条行为反馈实时排序';
  }
}
