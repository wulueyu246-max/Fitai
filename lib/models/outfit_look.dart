import 'product_search_requirement.dart';

class OutfitLook {
  const OutfitLook({
    required this.lookId,
    required this.requestId,
    required this.gender,
    required this.scene,
    required this.style,
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
      items: List<ProductSearchRequirement>.unmodifiable(
        rawItems.map((item) {
          if (item is! Map<String, dynamic>) {
            throw const FormatException('Look item 必须是对象');
          }
          return ProductSearchRequirement.fromJson(
            {...item, 'look_id': lookId},
            fallbackGender: gender,
          );
        }),
      ),
    );
  }

  final String lookId;
  final String requestId;
  final String gender;
  final String scene;
  final String style;
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
        items: items,
      );

  Map<String, dynamic> toJson() => {
        'request_id': requestId,
        'look_id': lookId,
        'gender': gender,
        'scene': scene,
        'style': style,
        'items': items.map((item) => item.toJson()).toList(growable: false),
      };

  static String _string(Object? value) => value?.toString().trim() ?? '';

  static String _normalizeGender(String value) {
    return switch (value.trim().toLowerCase()) {
      'male' || 'man' || 'men' || '男性' || '男士' || '男生' => 'male',
      'female' || 'woman' || 'women' || '女性' || '女士' || '女生' => 'female',
      _ => 'unisex',
    };
  }
}
