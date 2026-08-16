import 'outfit_plan.dart';
import 'outfit_blueprint.dart';
import 'outfit_look.dart';
import 'product.dart';
import 'product_recommendation.dart';
import 'product_search_requirement.dart';
import 'styling_strategy.dart';
import 'style_profile.dart';
import 'style_semantics.dart';

class OutfitAnalysis {
  const OutfitAnalysis({
    required this.bodyAnalysis,
    required this.style,
    required this.top,
    required this.bottom,
    required this.shoes,
    required this.accessories,
    required this.suggestion,
    this.gender = 'unisex',
    this.styleExpression = 'auto',
    this.styleSemantics = const StyleSemantics(),
    this.styleProfile = const StyleProfile(),
    this.outfitBlueprint = const OutfitBlueprint(),
    this.analysisMode = 'ai',
    this.stylingStrategy = const StylingStrategy(),
    this.recommendedProducts = const [],
    this.productRecommendations = const [],
    this.productRequirements = const [],
    this.requestId,
    this.outfitPlan,
    this.looks = const [],
    this.outfitPlans = const [],
    this.shoppingAgentStatus = 'disabled',
    this.shoppingAgentFirstFailureStage,
    this.shoppingAgentRetryable = false,
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
      gender: _readOptionalAliasedString(
        json,
        const ['gender'],
        fallback: 'unisex',
      ),
      styleExpression: _readOptionalAliasedString(
        json,
        const ['style_expression', 'styleExpression'],
        fallback: 'auto',
      ),
      styleSemantics: StyleSemantics.fromJson(
        json['style_semantics'] ?? json['styleSemantics'],
      ),
      styleProfile: StyleProfile.fromJson(
        json['style_profile'] ?? json['styleProfile'],
      ),
      outfitBlueprint: OutfitBlueprint.fromJson(
        json['outfit_blueprint'] ?? json['outfitBlueprint'],
      ),
      analysisMode: json['analysis_mode'] is String
          ? json['analysis_mode'] as String
          : 'ai',
      stylingStrategy: _readStylingStrategy(
        json['styling_strategy'] ?? json['stylingStrategy'],
      ),
      recommendedProducts: _readProducts(json['recommended_products']),
      productRecommendations: _readProductRecommendations(
        json['product_recommendations'],
      ),
      productRequirements:
          _readProductRequirements(json['product_requirements']),
      requestId: _readOptionalAliasedString(
        json,
        const ['request_id', 'requestId'],
        fallback: '',
      ),
      outfitPlan: _readOutfitPlan(json['outfit_plan']),
      looks: _readLooks(
        json['looks'],
        fallbackRequestId: _readOptionalAliasedString(
          json,
          const ['request_id', 'requestId'],
          fallback: '',
        ),
        fallbackGender: _readOptionalAliasedString(
          json,
          const ['gender'],
          fallback: 'unisex',
        ),
        fallbackScene: _readOptionalAliasedString(
          json,
          const ['scene'],
          fallback: '',
        ),
        fallbackStyle: _readOptionalAliasedString(
          json,
          const ['style'],
          fallback: '',
        ),
      ),
      outfitPlans: _readOutfitPlans(json['outfit_plans']),
      shoppingAgentStatus: _readOptionalAliasedString(
        json,
        const ['shopping_agent_status', 'shoppingAgentStatus'],
        fallback: 'disabled',
      ),
      shoppingAgentFirstFailureStage: _readOptionalAliasedString(
        json,
        const [
          'shopping_agent_first_failure_stage',
          'shoppingAgentFirstFailureStage',
        ],
        fallback: '',
      ),
      shoppingAgentRetryable:
          json['shopping_agent_retryable'] as bool? ?? false,
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
    final responseGender = _readOptionalAliasedString(
      json,
      const ['gender'],
      fallback: 'unisex',
    );
    final requestId = _readOptionalAliasedString(
      json,
      const ['request_id', 'requestId'],
      fallback: '',
    );
    final outfitLooks = _readLooks(
      json['looks'],
      fallbackRequestId: requestId,
      fallbackGender: responseGender,
      fallbackScene: '',
      fallbackStyle: _readOptionalAliasedString(
        json,
        const ['style'],
        fallback: '',
      ),
    );
    final productRequirements = outfitLooks.isNotEmpty
        ? List<ProductSearchRequirement>.unmodifiable(
            outfitLooks.expand((look) => look.items),
          )
        : _readProductRequirements(
            json['products'],
            fallbackGender: responseGender,
          );
    final gender = responseGender == 'unisex'
        ? _commonRequirementGender(productRequirements)
        : responseGender;

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
      gender: gender,
      styleExpression: _readOptionalAliasedString(
        json,
        const ['style_expression', 'styleExpression'],
        fallback: 'auto',
      ),
      styleSemantics: StyleSemantics.fromJson(
        json['style_semantics'] ?? json['styleSemantics'],
      ),
      styleProfile: StyleProfile.fromJson(
        json['style_profile'] ?? json['styleProfile'],
      ),
      outfitBlueprint: OutfitBlueprint.fromJson(
        json['outfit_blueprint'] ?? json['outfitBlueprint'],
      ),
      analysisMode: _readOptionalAliasedString(
        json,
        const ['analysisMode', 'analysis_mode'],
        fallback: 'ai',
      ),
      stylingStrategy: _readStylingStrategy(
        json['styling_strategy'] ?? json['stylingStrategy'],
      ),
      recommendedProducts: json['shopping_agent_products'] is List
          ? _readProducts(json['shopping_agent_products'])
          : productRecommendations.isEmpty
              ? _readVisionProducts(json['products'])
              : List<Product>.unmodifiable(
                  productRecommendations.map(
                    (recommendation) => recommendation.toProduct(),
                  ),
                ),
      productRecommendations: productRecommendations,
      productRequirements: productRequirements,
      requestId: requestId,
      outfitPlan: _readOutfitPlan(json['outfit_plan']),
      looks: outfitLooks,
      outfitPlans: _readOutfitPlans(json['outfit_plans']),
      shoppingAgentStatus: _readOptionalAliasedString(
        json,
        const ['shopping_agent_status', 'shoppingAgentStatus'],
        fallback: 'disabled',
      ),
      shoppingAgentFirstFailureStage: _readOptionalAliasedString(
        json,
        const [
          'shopping_agent_first_failure_stage',
          'shoppingAgentFirstFailureStage',
        ],
        fallback: '',
      ),
      shoppingAgentRetryable:
          json['shopping_agent_retryable'] as bool? ?? false,
    );
  }

  final String bodyAnalysis;
  final String style;
  final String top;
  final String bottom;
  final String shoes;
  final String accessories;
  final String suggestion;
  final String gender;
  final String styleExpression;
  final StyleSemantics styleSemantics;
  final StyleProfile styleProfile;
  final OutfitBlueprint outfitBlueprint;
  final String analysisMode;
  final StylingStrategy stylingStrategy;
  final List<Product> recommendedProducts;
  final List<ProductRecommendation> productRecommendations;
  final List<ProductSearchRequirement> productRequirements;
  final String? requestId;
  final OutfitPlan? outfitPlan;
  final List<OutfitLook> looks;
  final List<OutfitPlan> outfitPlans;
  final String shoppingAgentStatus;
  final String? shoppingAgentFirstFailureStage;
  final bool shoppingAgentRetryable;

  bool get isMock => analysisMode == 'mock';
  bool get hasShoppingAgentResult => shoppingAgentStatus == 'success';
  bool get hasShoppingAgentFailure => shoppingAgentStatus == 'failed';

  OutfitAnalysis copyWith({
    String? bodyAnalysis,
    String? style,
    String? top,
    String? bottom,
    String? shoes,
    String? accessories,
    String? suggestion,
    String? gender,
    String? styleExpression,
    StyleSemantics? styleSemantics,
    StyleProfile? styleProfile,
    OutfitBlueprint? outfitBlueprint,
    String? analysisMode,
    StylingStrategy? stylingStrategy,
    List<Product>? recommendedProducts,
    List<ProductRecommendation>? productRecommendations,
    List<ProductSearchRequirement>? productRequirements,
    String? requestId,
    OutfitPlan? outfitPlan,
    List<OutfitLook>? looks,
    List<OutfitPlan>? outfitPlans,
    String? shoppingAgentStatus,
    String? shoppingAgentFirstFailureStage,
    bool? shoppingAgentRetryable,
  }) {
    return OutfitAnalysis(
      bodyAnalysis: bodyAnalysis ?? this.bodyAnalysis,
      style: style ?? this.style,
      top: top ?? this.top,
      bottom: bottom ?? this.bottom,
      shoes: shoes ?? this.shoes,
      accessories: accessories ?? this.accessories,
      suggestion: suggestion ?? this.suggestion,
      gender: gender ?? this.gender,
      styleExpression: styleExpression ?? this.styleExpression,
      styleSemantics: styleSemantics ?? this.styleSemantics,
      styleProfile: styleProfile ?? this.styleProfile,
      outfitBlueprint: outfitBlueprint ?? this.outfitBlueprint,
      analysisMode: analysisMode ?? this.analysisMode,
      stylingStrategy: stylingStrategy ?? this.stylingStrategy,
      recommendedProducts: recommendedProducts ?? this.recommendedProducts,
      productRecommendations:
          productRecommendations ?? this.productRecommendations,
      productRequirements: productRequirements ?? this.productRequirements,
      requestId: requestId ?? this.requestId,
      outfitPlan: outfitPlan ?? this.outfitPlan,
      looks: looks ?? this.looks,
      outfitPlans: outfitPlans ?? this.outfitPlans,
      shoppingAgentStatus: shoppingAgentStatus ?? this.shoppingAgentStatus,
      shoppingAgentFirstFailureStage:
          shoppingAgentFirstFailureStage ?? this.shoppingAgentFirstFailureStage,
      shoppingAgentRetryable:
          shoppingAgentRetryable ?? this.shoppingAgentRetryable,
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
      'gender': gender,
      'style_expression': styleExpression,
      'style_semantics': styleSemantics.toJson(),
      'style_profile': styleProfile.toJson(),
      'outfit_blueprint': outfitBlueprint.toJson(),
      'analysis_mode': analysisMode,
      'styling_strategy': stylingStrategy.toJson(),
      'recommended_products':
          recommendedProducts.map((product) => product.toJson()).toList(),
      'product_recommendations': productRecommendations
          .map((recommendation) => recommendation.toJson())
          .toList(),
      'product_requirements': productRequirements
          .map((requirement) => requirement.toJson())
          .toList(),
      'request_id': requestId,
      'outfit_plan': outfitPlan?.toJson(),
      'looks': looks.map((look) => look.toJson()).toList(growable: false),
      'outfit_plans':
          outfitPlans.map((plan) => plan.toJson()).toList(growable: false),
      'shopping_agent_status': shoppingAgentStatus,
      'shopping_agent_first_failure_stage': shoppingAgentFirstFailureStage,
      'shopping_agent_retryable': shoppingAgentRetryable,
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

  static StylingStrategy _readStylingStrategy(dynamic value) {
    if (value == null) return const StylingStrategy();
    if (value is! Map<String, dynamic>) {
      throw const FormatException('styling_strategy 必须是对象');
    }
    return StylingStrategy.fromJson(value);
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

  static List<ProductSearchRequirement> _readProductRequirements(
    dynamic value, {
    String fallbackGender = 'unisex',
  }) {
    if (value == null) return const [];
    if (value is! List) {
      throw const FormatException('products must be an array');
    }
    return List<ProductSearchRequirement>.unmodifiable(
      value.map((item) {
        if (item is! Map<String, dynamic>) {
          throw const FormatException('products entries must be objects');
        }
        return ProductSearchRequirement.fromJson(
          item,
          fallbackGender: fallbackGender,
        );
      }),
    );
  }

  static String _commonRequirementGender(
    List<ProductSearchRequirement> requirements,
  ) {
    final genders = requirements
        .map((requirement) => requirement.gender)
        .where((gender) => gender != 'unisex')
        .toSet();
    return genders.length == 1 ? genders.single : 'unisex';
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

  static List<OutfitLook> _readLooks(
    dynamic value, {
    required String fallbackRequestId,
    required String fallbackGender,
    required String fallbackScene,
    required String fallbackStyle,
  }) {
    if (value == null) return const [];
    if (value is! List) throw const FormatException('looks 必须是数组');
    return List<OutfitLook>.unmodifiable(value.map((item) {
      if (item is! Map<String, dynamic>) {
        throw const FormatException('looks 中的元素必须是对象');
      }
      return OutfitLook.fromJson(
        item,
        fallbackRequestId: fallbackRequestId,
        fallbackGender: fallbackGender,
        fallbackScene: fallbackScene,
        fallbackStyle: fallbackStyle,
      );
    }));
  }

  static List<OutfitPlan> _readOutfitPlans(dynamic value) {
    if (value == null) return const [];
    if (value is! List) throw const FormatException('outfit_plans 必须是数组');
    return List<OutfitPlan>.unmodifiable(value.map((item) {
      if (item is! Map<String, dynamic>) {
        throw const FormatException('outfit_plans 中的元素必须是对象');
      }
      return OutfitPlan.fromJson(item);
    }));
  }
}
