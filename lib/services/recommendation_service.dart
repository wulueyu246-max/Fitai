import '../data/mock_product_database.dart';
import '../models/outfit_plan.dart';
import '../models/outfit_look.dart';
import '../models/outfit_post.dart';
import '../models/product.dart';
import '../models/user_preference.dart';

class RecommendationProfile {
  const RecommendationProfile({
    required this.height,
    required this.weight,
    required this.bodyType,
    required this.shoulderRatio,
    required this.legRatio,
    required this.style,
    required this.scene,
  });

  final double height;
  final double weight;
  final String bodyType;
  final String shoulderRatio;
  final String legRatio;
  final String style;
  final String scene;
}

class RecommendationService {
  const RecommendationService();

  List<Product> recommendProducts({
    required double height,
    required double weight,
    required String bodyType,
    required String shoulderRatio,
    required String legRatio,
    required String style,
    required String scene,
    UserPreference? preference,
    int limit = 12,
    List<Product>? catalog,
  }) {
    final profile = RecommendationProfile(
      height: height,
      weight: weight,
      bodyType: bodyType,
      shoulderRatio: shoulderRatio,
      legRatio: legRatio,
      style: style,
      scene: scene,
    );
    final sourceProducts = catalog ?? MockProductDatabase.products;
    final scored = sourceProducts
        .where((product) => product.isAvailable && product.tryOnAvailable)
        .map(
          (product) => (
            product: product,
            score: _score(product, profile, preference),
          ),
        )
        .toList()
      ..sort((left, right) {
        final scoreComparison = right.score.compareTo(left.score);
        return scoreComparison != 0
            ? scoreComparison
            : left.product.id.compareTo(right.product.id);
      });

    final selected = <Product>[];
    for (final slot in const [
      ProductCategory.top,
      ProductCategory.bottom,
      ProductCategory.shoes,
      ProductCategory.outerwear,
    ]) {
      final matches =
          scored.where((candidate) => candidate.product.wardrobeSlot == slot);
      if (matches.isNotEmpty) {
        selected.add(
          _personalize(matches.first.product, profile, preference),
        );
      }
    }

    for (final candidate in scored) {
      if (selected.length >= limit) {
        break;
      }
      if (selected.any((product) => product.id == candidate.product.id)) {
        continue;
      }
      selected.add(_personalize(candidate.product, profile, preference));
    }

    return List<Product>.unmodifiable(selected.take(limit));
  }

  OutfitPlan buildOutfitPlan({
    required List<Product> products,
    required String style,
    required String scene,
    String styleDirection = '',
    List<AccessoryDecision> accessoryDecisions = const [],
    String requestId = '',
    String gender = 'unisex',
    String lookId = '',
    List<Product> additionalProducts = const [],
    DateTime? createdTime,
    List<Product>? catalog,
  }) {
    Product firstFor(String slot) {
      return products.firstWhere(
        (product) => product.wardrobeSlot == slot,
        orElse: () {
          final fallbackCatalog = catalog;
          if (fallbackCatalog == null) {
            throw StateError('当前结果缺少 $slot，禁止使用默认 Look 补位');
          }
          return fallbackCatalog.firstWhere(
            (product) => product.isAvailable && product.wardrobeSlot == slot,
          );
        },
      );
    }

    final top = firstFor(ProductCategory.top);
    final bottom = firstFor(ProductCategory.bottom);
    final shoes = firstFor(ProductCategory.shoes);
    final timestamp = createdTime ?? DateTime.now();
    final normalizedScene = scene.trim().isEmpty ? '日常' : scene.trim();
    final normalizedStyle = style.trim().isEmpty ? '高级感' : style.trim();

    return OutfitPlan(
      id: 'plan-$normalizedScene-$normalizedStyle-'
          '${timestamp.microsecondsSinceEpoch}',
      title: '你的$normalizedScene$normalizedStyle方案',
      top: top,
      bottom: bottom,
      shoes: shoes,
      reason: '以${top.name}建立上身重点，搭配${bottom.name}延伸腿部线条，'
          '最后用${shoes.name}统一视觉重心。',
      createdTime: timestamp,
      scene: normalizedScene,
      style: normalizedStyle,
      styleDirection: styleDirection.trim(),
      accessoryDecisions: accessoryDecisions,
      gender: gender,
      requestId: requestId.trim(),
      lookId: lookId.trim(),
      additionalProducts: additionalProducts,
      matchScore: 88 + (products.length.clamp(3, 10) - 3),
    );
  }

  List<OutfitPlan> buildOutfitPlans({
    required List<Product> products,
    required List<OutfitLook> looks,
    required String requestId,
    required String gender,
    DateTime? createdTime,
  }) {
    final plans = <OutfitPlan>[];
    for (final look in looks) {
      if (!look.matches(requestId: requestId, gender: gender)) continue;
      final lookProducts = products
          .where((product) => product.lookId == look.lookId)
          .toList(growable: false);
      final categories =
          lookProducts.map((product) => product.wardrobeSlot).toSet();
      if (!categories.contains(ProductCategory.top) ||
          !categories.contains(ProductCategory.bottom) ||
          !categories.contains(ProductCategory.shoes)) {
        continue;
      }
      final extras = <Product>[];
      for (final category in const [
        ProductCategory.outerwear,
        ProductCategory.accessories,
      ]) {
        final matches = lookProducts.where(
          (product) => product.wardrobeSlot == category,
        );
        if (matches.isNotEmpty) extras.add(matches.first);
      }
      plans.add(
        buildOutfitPlan(
          products: lookProducts,
          style: look.style,
          styleDirection: look.styleDirection,
          accessoryDecisions: look.accessoryDecisions,
          scene: look.scene,
          requestId: requestId,
          gender: gender,
          lookId: look.lookId,
          additionalProducts: extras,
          createdTime: createdTime,
        ),
      );
    }
    if (plans.isEmpty) {
      throw StateError('当前商品没有组成与 AI Look 对应的完整搭配');
    }
    return List<OutfitPlan>.unmodifiable(plans);
  }

  List<OutfitPost> recommendPosts({
    required List<OutfitPost> posts,
    required UserPreference preference,
    required String channel,
    String query = '',
  }) {
    final scored = posts
        .where((post) => post.matchesQuery(query))
        .map(
          (post) => (
            post: post,
            score: _postScore(post, preference, channel),
          ),
        )
        .toList()
      ..sort((left, right) {
        final score = right.score.compareTo(left.score);
        return score != 0 ? score : right.post.likes.compareTo(left.post.likes);
      });
    return List<OutfitPost>.unmodifiable(
      scored.map((item) => item.post),
    );
  }

  int _score(
    Product product,
    RecommendationProfile profile,
    UserPreference? preference,
  ) {
    var score = 0;
    final sceneStyles = _sceneStyles(profile.scene);

    if (_matches(profile.style, product.style)) {
      score += 8;
    }
    if (sceneStyles.contains(product.style)) {
      score += 6;
    }
    if (_seasonMatches(product.season)) {
      score += 3;
    }

    if (_hasNarrowShoulder(profile.shoulderRatio) ||
        _hasNarrowShoulder(profile.bodyType)) {
      if (product.fitType.contains('肩') ||
          product.wardrobeSlot == ProductCategory.outerwear ||
          product.fitType.contains('宽松')) {
        score += 7;
      }
    }

    if (_hasShortLegRatio(profile.legRatio) || profile.height < 175) {
      if (product.fitType.contains('高腰') || product.fitType.contains('增高')) {
        score += 6;
      }
    }

    final heightInMeters = profile.height / 100;
    final bmi = profile.weight / (heightInMeters * heightInMeters);
    if (bmi < 20 &&
        (product.fitType.contains('宽松') || product.fitType.contains('廓形'))) {
      score += 3;
    }
    if (bmi >= 24 &&
        (product.fitType.contains('直身') || product.fitType.contains('直筒'))) {
      score += 3;
    }
    if (preference != null) {
      if (preference.likedStyles.any(
        (style) => _matches(style, product.style),
      )) {
        score += 5;
      }
      if (preference.likedColors.any(product.color.contains)) {
        score += 4;
      }
      if (preference.purchaseHistory.contains(product.sku)) {
        score += 2;
      }
    }
    return score;
  }

  Product _personalize(
    Product product,
    RecommendationProfile profile,
    UserPreference? preference,
  ) {
    final reasons = <String>[];
    if (_hasNarrowShoulder(profile.shoulderRatio) ||
        _hasNarrowShoulder(profile.bodyType)) {
      if (product.wardrobeSlot == ProductCategory.outerwear ||
          product.wardrobeSlot == ProductCategory.top) {
        reasons.add('针对肩部比例，${product.fitType}能增强上半身轮廓');
      }
    }
    if (_hasShortLegRatio(profile.legRatio) || profile.height < 175) {
      if (product.wardrobeSlot == ProductCategory.bottom ||
          product.wardrobeSlot == ProductCategory.shoes) {
        reasons.add('结合身高和腿长比例，${product.fitType}有助于拉长下半身线条');
      }
    }
    if (reasons.isEmpty) {
      reasons.add('与你的${profile.style}偏好和${profile.scene}场景匹配');
    }
    if (preference != null &&
        preference.likedColors.any(product.color.contains)) {
      reasons.add('配色符合你近期偏好');
    }
    reasons.add(product.aiReason);
    return product.copyWith(aiReason: '${reasons.join('；')}。');
  }

  int _postScore(
    OutfitPost post,
    UserPreference preference,
    String channel,
  ) {
    var score = 0;
    final text = '${post.title}${post.description}';
    if (text.contains(channel)) {
      score += 10;
    }
    for (final style in preference.likedStyles) {
      if (text.contains(style) ||
          post.products.any((product) => product.style.contains(style))) {
        score += 4;
      }
    }
    for (final color in preference.likedColors) {
      if (post.products.any((product) => product.color.contains(color))) {
        score += 3;
      }
    }
    if (post.products.any(
      (product) => preference.purchaseHistory.contains(product.sku),
    )) {
      score += 2;
    }
    if (preference.browsingHistory.contains(post.id)) {
      score -= 1;
    }
    return score;
  }

  bool _matches(String userValue, String productValue) {
    return userValue.contains(productValue) ||
        productValue.contains(userValue) ||
        _sceneStyles(userValue).contains(productValue);
  }

  Set<String> _sceneStyles(String scene) {
    if (scene.contains('商务') ||
        scene.contains('通勤') ||
        scene.contains('正式') ||
        scene.contains('面试')) {
      return const {'商务', '通勤', '极简', '高级感'};
    }
    if (scene.contains('约会')) {
      return const {'约会', '高级感', '休闲'};
    }
    if (scene.contains('运动')) {
      return const {'运动', '休闲', '街头'};
    }
    return const {'休闲', '极简', '街头'};
  }

  bool _seasonMatches(String season) {
    final month = DateTime.now().month;
    final target = switch (month) {
      >= 3 && <= 5 => '春',
      >= 6 && <= 8 => '夏',
      >= 9 && <= 11 => '秋',
      _ => '冬',
    };
    return season == '四季' || season.contains(target);
  }

  bool _hasNarrowShoulder(String value) {
    return value.contains('肩窄') ||
        value.contains('窄肩') ||
        value.contains('偏窄') ||
        value.contains('小于');
  }

  bool _hasShortLegRatio(String value) {
    return value.contains('腿短') ||
        value.contains('偏短') ||
        value.contains('五五') ||
        value.contains('低于');
  }
}
