import 'product.dart';

class OutfitPlan {
  const OutfitPlan({
    required this.id,
    required this.title,
    required this.top,
    required this.bottom,
    required this.shoes,
    required this.reason,
    required this.createdTime,
    this.scene = '日常',
    this.style = '',
    this.gender = 'unisex',
    this.requestId = '',
    this.matchScore = 90,
  });

  factory OutfitPlan.fromJson(Map<String, dynamic> json) {
    return OutfitPlan(
      id: json['id'] as String,
      title: json['title'] as String,
      top: Product.fromJson(json['top'] as Map<String, dynamic>),
      bottom: Product.fromJson(json['bottom'] as Map<String, dynamic>),
      shoes: Product.fromJson(json['shoes'] as Map<String, dynamic>),
      reason: json['reason'] as String,
      createdTime: DateTime.parse(json['createdTime'] as String),
      scene: json['scene'] as String? ?? '日常',
      style: json['style'] as String? ?? '',
      gender: _normalizeGender(json['gender'] as String?),
      requestId:
          (json['request_id'] ?? json['requestId'])?.toString().trim() ?? '',
      matchScore: (json['matchScore'] as num?)?.round() ?? 90,
    );
  }

  final String id;
  final String title;
  final Product top;
  final Product bottom;
  final Product shoes;
  final String reason;
  final DateTime createdTime;
  final String scene;
  final String style;
  final String gender;
  final String requestId;
  final int matchScore;

  String get look => title;

  List<Product> get products => List<Product>.unmodifiable([
        top,
        bottom,
        shoes,
      ]);

  OutfitPlan replaceProduct(Product product) {
    return OutfitPlan(
      id: id,
      title: title,
      top: product.wardrobeSlot == ProductCategory.top ? product : top,
      bottom: product.wardrobeSlot == ProductCategory.bottom ? product : bottom,
      shoes: product.wardrobeSlot == ProductCategory.shoes ? product : shoes,
      reason: reason,
      createdTime: createdTime,
      scene: scene,
      style: style,
      gender: gender,
      requestId: requestId,
      matchScore: matchScore,
    );
  }

  bool matchesCurrentResult({
    required String requestId,
    required String gender,
  }) {
    final expectedRequestId = requestId.trim();
    return expectedRequestId.isNotEmpty &&
        this.requestId == expectedRequestId &&
        this.gender == _normalizeGender(gender);
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'look': look,
      'title': title,
      'products': products.map((product) => product.toJson()).toList(),
      'top': top.toJson(),
      'bottom': bottom.toJson(),
      'shoes': shoes.toJson(),
      'reason': reason,
      'scene': scene,
      'style': style,
      'gender': gender,
      'request_id': requestId,
      'matchScore': matchScore,
      'createdTime': createdTime.toIso8601String(),
    };
  }

  static String _normalizeGender(String? value) {
    return switch (value?.trim().toLowerCase()) {
      'male' || '男' || '男性' || '男士' => 'male',
      'female' || '女' || '女性' || '女士' => 'female',
      _ => 'unisex',
    };
  }
}
