import 'outfit_plan.dart';
import 'product.dart';
import 'product_recommendation.dart';

class OutfitAnalysis {
  const OutfitAnalysis({
    required this.bodyAnalysis,
    required this.style,
    required this.top,
    required this.bottom,
    required this.shoes,
    required this.accessories,
    required this.suggestion,
    this.analysisMode = 'ai',
    this.recommendedProducts = const [],
    this.productRecommendations = const [],
    this.outfitPlan,
  });

  factory OutfitAnalysis.fromJson(Map<String, dynamic> json) {
    if (json.containsKey('bodyProfile') ||
        json.containsKey('body_profile') ||
        json.containsKey('bodyAnalysis') ||
        json.containsKey('recommendations')) {
      return OutfitAnalysis._fromVisionApiJson(json);
    }

    return OutfitAnalysis(
      bodyAnalysis: _readString(json, 'body_analysis'),
      style: _readString(json, 'style'),
      top: _readString(json, 'top'),
      bottom: _readString(json, 'bottom'),
      shoes: _readString(json, 'shoes'),
      accessories: _readString(json, 'accessories'),
      suggestion: _readString(json, 'suggestion'),
      analysisMode: json['analysis_mode'] is String
          ? json['analysis_mode'] as String
          : 'ai',
      recommendedProducts: _readProducts(json['recommended_products']),
      productRecommendations: _readProductRecommendations(
        json['product_recommendations'],
      ),
      outfitPlan: _readOutfitPlan(json['outfit_plan']),
    );
  }

  factory OutfitAnalysis._fromVisionApiJson(Map<String, dynamic> json) {
    final recommendations = json['recommendations'];
    if (recommendations is! Map<String, dynamic>) {
      throw const FormatException('recommendations 必须是对象');
    }
    final productRecommendations = _readProductRecommendations(
      recommendations['products'],
    );

    return OutfitAnalysis(
      bodyAnalysis: _readAliasedString(
        json,
        const ['bodyProfile', 'body_profile', 'bodyAnalysis', 'body_analysis'],
      ),
      style: _readString(json, 'style'),
      top: _readAliasedString(
        recommendations,
        const ['top', 'topRecommendation', 'top_recommendation'],
      ),
      bottom: _readAliasedString(
        recommendations,
        const ['bottom', 'bottomRecommendation', 'bottom_recommendation'],
      ),
      shoes: _readAliasedString(
        recommendations,
        const ['shoes', 'shoeRecommendation', 'shoe_recommendation'],
      ),
      accessories: _readAliasedString(
        recommendations,
        const [
          'accessories',
          'accessoryRecommendation',
          'accessory_recommendation',
        ],
      ),
      suggestion: _readAliasedString(
        recommendations,
        const ['summary', 'suggestion'],
      ),
      analysisMode: _readOptionalAliasedString(
        json,
        const ['analysisMode', 'analysis_mode'],
        fallback: 'ai',
      ),
      recommendedProducts: productRecommendations.isEmpty
          ? _readVisionProducts(json['products'])
          : List<Product>.unmodifiable(
              productRecommendations.map(
                (recommendation) => recommendation.toProduct(),
              ),
            ),
      productRecommendations: productRecommendations,
    );
  }

  final String bodyAnalysis;
  final String style;
  final String top;
  final String bottom;
  final String shoes;
  final String accessories;
  final String suggestion;
  final String analysisMode;
  final List<Product> recommendedProducts;
  final List<ProductRecommendation> productRecommendations;
  final OutfitPlan? outfitPlan;

  bool get isMock => analysisMode == 'mock';

  OutfitAnalysis copyWith({
    String? bodyAnalysis,
    String? style,
    String? top,
    String? bottom,
    String? shoes,
    String? accessories,
    String? suggestion,
    String? analysisMode,
    List<Product>? recommendedProducts,
    List<ProductRecommendation>? productRecommendations,
    OutfitPlan? outfitPlan,
  }) {
    return OutfitAnalysis(
      bodyAnalysis: bodyAnalysis ?? this.bodyAnalysis,
      style: style ?? this.style,
      top: top ?? this.top,
      bottom: bottom ?? this.bottom,
      shoes: shoes ?? this.shoes,
      accessories: accessories ?? this.accessories,
      suggestion: suggestion ?? this.suggestion,
      analysisMode: analysisMode ?? this.analysisMode,
      recommendedProducts: recommendedProducts ?? this.recommendedProducts,
      productRecommendations:
          productRecommendations ?? this.productRecommendations,
      outfitPlan: outfitPlan ?? this.outfitPlan,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'body_analysis': bodyAnalysis,
      'style': style,
      'top': top,
      'bottom': bottom,
      'shoes': shoes,
      'accessories': accessories,
      'suggestion': suggestion,
      'analysis_mode': analysisMode,
      'recommended_products':
          recommendedProducts.map((product) => product.toJson()).toList(),
      'product_recommendations': productRecommendations
          .map((recommendation) => recommendation.toJson())
          .toList(),
      'outfit_plan': outfitPlan?.toJson(),
    };
  }

  static String _readString(Map<String, dynamic> json, String key) {
    final value = json[key];

    if (value is! String || value.trim().isEmpty) {
      throw FormatException('缺少字符串字段：$key');
    }

    return value.trim();
  }

  static String _readAliasedString(
    Map<String, dynamic> json,
    List<String> keys,
  ) {
    for (final key in keys) {
      final value = json[key];
      if (value is String && value.trim().isNotEmpty) {
        return value.trim();
      }
    }
    throw FormatException('缺少字符串字段：${keys.join('/')}');
  }

  static String _readOptionalAliasedString(
    Map<String, dynamic> json,
    List<String> keys, {
    required String fallback,
  }) {
    for (final key in keys) {
      final value = json[key];
      if (value is String && value.trim().isNotEmpty) {
        return value.trim();
      }
    }
    return fallback;
  }

  static List<Product> _readProducts(dynamic value) {
    if (value == null) {
      return const [];
    }

    if (value is! List) {
      throw const FormatException('recommended_products 必须是数组');
    }

    return List<Product>.unmodifiable(
      value.map((item) {
        if (item is! Map<String, dynamic>) {
          throw const FormatException('推荐商品必须是对象');
        }

        return Product.fromJson(item);
      }),
    );
  }

  static List<Product> _readVisionProducts(dynamic value) {
    if (value == null) {
      return const [];
    }
    if (value is! List) {
      throw const FormatException('products 必须是数组');
    }

    final productMaps = value.whereType<Map<String, dynamic>>().toList();
    if (productMaps.length != value.length ||
        productMaps.any((item) => item['name'] is! String)) {
      return const [];
    }

    return List<Product>.unmodifiable(
      productMaps.indexed.map((entry) {
        final (index, item) = entry;
        return Product.fromAiRecommendation(item, index: index);
      }),
    );
  }

  static List<ProductRecommendation> _readProductRecommendations(
    dynamic value,
  ) {
    if (value == null) {
      return const [];
    }
    if (value is! List) {
      throw const FormatException('recommendations.products 必须是数组');
    }

    return List<ProductRecommendation>.unmodifiable(
      value.map((item) {
        if (item is! Map<String, dynamic>) {
          throw const FormatException(
            'recommendations.products 中的商品必须是对象',
          );
        }
        return ProductRecommendation.fromJson(item);
      }),
    );
  }

  static OutfitPlan? _readOutfitPlan(dynamic value) {
    if (value == null) {
      return null;
    }
    if (value is! Map<String, dynamic>) {
      throw const FormatException('outfit_plan 必须是对象');
    }
    return OutfitPlan.fromJson(value);
  }
}
