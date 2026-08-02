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
      matchScore: matchScore,
    );
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
      'matchScore': matchScore,
      'createdTime': createdTime.toIso8601String(),
    };
  }
}
