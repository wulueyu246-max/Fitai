import 'fashion_profile.dart';
import 'user_profile.dart';

class UserFashionProfile {
  const UserFashionProfile({
    required this.height,
    required this.weight,
    required this.bodyType,
    required this.favoriteColors,
    required this.favoriteBrands,
    required this.budgetMin,
    required this.budgetMax,
    required this.occupation,
    required this.sceneNeeds,
    required this.clickHistory,
  });

  factory UserFashionProfile.fromProfiles({
    required UserProfile user,
    required FashionProfile fashion,
  }) {
    return UserFashionProfile(
      height: user.height,
      weight: user.weight,
      bodyType: user.bodyType,
      favoriteColors: {
        ...user.favoriteColors,
        ...fashion.commonColors,
      }.toList(growable: false),
      favoriteBrands: {
        ...user.favoriteBrands,
        ...fashion.likedBrands,
      }.toList(growable: false),
      budgetMin: user.budgetMin,
      budgetMax: user.budgetMax,
      occupation: user.occupation,
      sceneNeeds: user.sceneNeeds,
      clickHistory: const [],
    );
  }

  factory UserFashionProfile.fromJson(Map<String, dynamic> json) {
    List<String> list(String key) => (json[key] as List<dynamic>? ?? const [])
        .whereType<String>()
        .toList(growable: false);
    double number(String key, double fallback) {
      final value = json[key];
      return value is num
          ? value.toDouble()
          : double.tryParse(value?.toString() ?? '') ?? fallback;
    }

    return UserFashionProfile(
      height: number('height', 173),
      weight: number('weight', 60),
      bodyType: json['bodyType'] as String? ?? '匀称体型',
      favoriteColors: list('favoriteColors'),
      favoriteBrands: list('favoriteBrands'),
      budgetMin: number('budgetMin', 100),
      budgetMax: number('budgetMax', 1200),
      occupation: json['occupation'] as String? ?? '城市职场',
      sceneNeeds: list('sceneNeeds'),
      clickHistory: list('clickHistory'),
    );
  }

  final double height;
  final double weight;
  final String bodyType;
  final List<String> favoriteColors;
  final List<String> favoriteBrands;
  final double budgetMin;
  final double budgetMax;
  final String occupation;
  final List<String> sceneNeeds;
  final List<String> clickHistory;

  bool isWithinBudget(String price) {
    final amount = double.tryParse(price.replaceAll(RegExp(r'[^0-9.]'), ''));
    return amount != null && amount >= budgetMin && amount <= budgetMax;
  }

  UserFashionProfile copyWith({
    double? height,
    double? weight,
    String? bodyType,
    List<String>? favoriteColors,
    List<String>? favoriteBrands,
    double? budgetMin,
    double? budgetMax,
    String? occupation,
    List<String>? sceneNeeds,
    List<String>? clickHistory,
  }) {
    return UserFashionProfile(
      height: height ?? this.height,
      weight: weight ?? this.weight,
      bodyType: bodyType ?? this.bodyType,
      favoriteColors: favoriteColors ?? this.favoriteColors,
      favoriteBrands: favoriteBrands ?? this.favoriteBrands,
      budgetMin: budgetMin ?? this.budgetMin,
      budgetMax: budgetMax ?? this.budgetMax,
      occupation: occupation ?? this.occupation,
      sceneNeeds: sceneNeeds ?? this.sceneNeeds,
      clickHistory: clickHistory ?? this.clickHistory,
    );
  }

  Map<String, dynamic> toJson() => {
        'height': height,
        'weight': weight,
        'bodyType': bodyType,
        'favoriteColors': favoriteColors,
        'favoriteBrands': favoriteBrands,
        'budgetMin': budgetMin,
        'budgetMax': budgetMax,
        'occupation': occupation,
        'sceneNeeds': sceneNeeds,
        'clickHistory': clickHistory,
      };
}
