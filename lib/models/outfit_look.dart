import 'product_search_requirement.dart';

class AccessoryDecision {
  const AccessoryDecision({
    required this.category,
    required this.include,
    required this.reason,
  });

  factory AccessoryDecision.fromJson(Map<String, dynamic> json) {
    final category = _normalizeCategory(json['category']);
    final include = json['include'];
    final reason = json['reason']?.toString().trim() ?? '';
    if (category.isEmpty || include is! bool || reason.isEmpty) {
      throw const FormatException('accessories_decision 结构无效');
    }
    return AccessoryDecision(
      category: category,
      include: include,
      reason: reason,
    );
  }

  final String category;
  final bool include;
  final String reason;

  String get label => switch (category) {
        'hat' => '帽子',
        'bag' => '包袋',
        'glasses' => '眼镜',
        'belt' => '腰带',
        'jewelry' => '首饰',
        'scarf' => '围巾',
        'watch' => '腕表',
        _ => '配饰',
      };

  Map<String, dynamic> toJson() => {
        'category': category,
        'include': include,
        'reason': reason,
      };

  static String _normalizeCategory(Object? value) {
    final normalized = value?.toString().trim().toLowerCase() ?? '';
    return const {
      'hat',
      'bag',
      'glasses',
      'belt',
      'jewelry',
      'scarf',
      'watch',
    }.contains(normalized)
        ? normalized
        : '';
  }
}

class OutfitLook {
  const OutfitLook({
    required this.lookId,
    required this.requestId,
    required this.gender,
    required this.scene,
    required this.style,
    this.styleDirection = '',
    this.stylingGoal = '',
    this.proportionStrategy = '',
    this.proportionExplanation = '',
    this.accessoryDecisions = const [],
    required this.items,
  });

  factory OutfitLook.fromJson(
    Map<String, dynamic> json, {
    String fallbackRequestId = '',
    String fallbackGender = 'unisex',
    String fallbackScene = '',
    String fallbackStyle = '',
  }) {
    final lookId = _string(json['look_id'] ?? json['lookId']);
    if (lookId.isEmpty) {
      throw const FormatException('Look 缺少 look_id');
    }
    final gender = _normalizeGender(
      _string(json['gender']).isEmpty
          ? fallbackGender
          : _string(json['gender']),
    );
    final rawItems = json['items'];
    if (rawItems is! List || rawItems.isEmpty) {
      throw const FormatException('Look items 必须是非空数组');
    }
    final hasAccessoryDecisions = json.containsKey('accessories_decision') ||
        json.containsKey('accessoriesDecision');
    final accessoryDecisions = _readAccessoryDecisions(
      json['accessories_decision'] ?? json['accessoriesDecision'],
    );
    final parsedItems = rawItems.map((item) {
      if (item is! Map<String, dynamic>) {
        throw const FormatException('Look item 必须是对象');
      }
      return ProductSearchRequirement.fromJson(
        {...item, 'look_id': lookId},
        fallbackGender: gender,
      );
    }).toList(growable: false);
    final includedAccessories = accessoryDecisions
        .where((decision) => decision.include)
        .map((decision) => decision.category)
        .toSet();
    return OutfitLook(
      lookId: lookId,
      requestId: _string(json['request_id'] ?? json['requestId']).isEmpty
          ? fallbackRequestId
          : _string(json['request_id'] ?? json['requestId']),
      gender: gender,
      scene: _string(json['scene']).isEmpty
          ? fallbackScene
          : _string(json['scene']),
      style: _string(json['style']).isEmpty
          ? fallbackStyle
          : _string(json['style']),
      styleDirection: _string(
        json['style_direction'] ?? json['styleDirection'],
      ),
      stylingGoal: _string(json['styling_goal'] ?? json['stylingGoal']),
      proportionStrategy: _string(
        json['proportion_strategy'] ?? json['proportionStrategy'],
      ),
      proportionExplanation: _string(
        json['why_this_changes_the_body_proportion'] ??
            json['whyThisChangesTheBodyProportion'],
      ),
      accessoryDecisions: accessoryDecisions,
      items: List<ProductSearchRequirement>.unmodifiable(
        hasAccessoryDecisions
            ? parsedItems.where((item) {
                final accessoryType = _accessoryTypeForItem(item);
                return accessoryType.isEmpty ||
                    includedAccessories.contains(accessoryType);
              })
            : parsedItems,
      ),
    );
  }

  final String lookId;
  final String requestId;
  final String gender;
  final String scene;
  final String style;
  final String styleDirection;
  final String stylingGoal;
  final String proportionStrategy;
  final String proportionExplanation;
  final List<AccessoryDecision> accessoryDecisions;
  final List<ProductSearchRequirement> items;

  bool matches({required String requestId, required String gender}) {
    return this.requestId == requestId.trim() &&
        this.gender == _normalizeGender(gender);
  }

  OutfitLook copyWith({String? requestId}) => OutfitLook(
        lookId: lookId,
        requestId: requestId ?? this.requestId,
        gender: gender,
        scene: scene,
        style: style,
        styleDirection: styleDirection,
        stylingGoal: stylingGoal,
        proportionStrategy: proportionStrategy,
        proportionExplanation: proportionExplanation,
        accessoryDecisions: accessoryDecisions,
        items: items,
      );

  Map<String, dynamic> toJson() => {
        'request_id': requestId,
        'look_id': lookId,
        'gender': gender,
        'scene': scene,
        'style': style,
        'style_direction': styleDirection,
        'styling_goal': stylingGoal,
        'proportion_strategy': proportionStrategy,
        'why_this_changes_the_body_proportion': proportionExplanation,
        if (accessoryDecisions.isNotEmpty)
          'accessories_decision': accessoryDecisions
              .map((decision) => decision.toJson())
              .toList(growable: false),
        'items': items.map((item) => item.toJson()).toList(growable: false),
      };

  static List<AccessoryDecision> _readAccessoryDecisions(Object? value) {
    if (value == null) return const [];
    if (value is! List) {
      throw const FormatException('accessories_decision 必须是数组');
    }
    return List<AccessoryDecision>.unmodifiable(value.map((item) {
      if (item is! Map<String, dynamic>) {
        throw const FormatException('accessories_decision 元素必须是对象');
      }
      return AccessoryDecision.fromJson(item);
    }));
  }

  static String _accessoryTypeForItem(ProductSearchRequirement item) {
    final evidence = '${item.category} ${item.itemName}'.toLowerCase();
    if (RegExp(r'帽|\b(?:hat|cap)\b').hasMatch(evidence)) return 'hat';
    if (RegExp(r'包|\b(?:bag|handbag|tote)\b').hasMatch(evidence)) {
      return 'bag';
    }
    if (RegExp(r'眼镜|墨镜|太阳镜|\b(?:glasses|sunglasses)\b').hasMatch(evidence)) {
      return 'glasses';
    }
    if (RegExp(r'腰带|皮带|\bbelt\b').hasMatch(evidence)) return 'belt';
    if (RegExp(r'珠宝|首饰|项链|耳环|耳饰|手链|戒指|jewelry|necklace|earring')
        .hasMatch(evidence)) {
      return 'jewelry';
    }
    if (RegExp(r'围巾|丝巾|\bscarf\b').hasMatch(evidence)) return 'scarf';
    if (RegExp(r'手表|腕表|\bwatch\b').hasMatch(evidence)) return 'watch';
    return '';
  }

  static String _string(Object? value) => value?.toString().trim() ?? '';

  static String _normalizeGender(String value) {
    return switch (value.trim().toLowerCase()) {
      'male' || 'man' || 'men' || '男性' || '男士' || '男生' => 'male',
      'female' || 'woman' || 'women' || '女性' || '女士' || '女生' => 'female',
      _ => 'unisex',
    };
  }
}
