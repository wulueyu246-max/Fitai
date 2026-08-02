import 'user_preference.dart';
import 'user_profile.dart';

class FashionProfile {
  const FashionProfile({
    required this.likedStyles,
    required this.likedBrands,
    required this.budgetMin,
    required this.budgetMax,
    required this.commonColors,
    required this.bodyFeatures,
    required this.purchaseHistory,
    this.personaLabels = const [],
    this.evidence = const [],
    this.confidence = 0,
    this.generatedAt,
  });

  factory FashionProfile.fromJson(Map<String, dynamic> json) {
    List<String> readList(String key) {
      return (json[key] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(growable: false);
    }

    double readBudget(String key, double fallback) {
      final value = json[key];
      return value is num
          ? value.toDouble()
          : double.tryParse(value?.toString() ?? '') ?? fallback;
    }

    return FashionProfile(
      likedStyles: readList('likedStyles'),
      likedBrands: readList('likedBrands'),
      budgetMin: readBudget('budgetMin', 100),
      budgetMax: readBudget('budgetMax', 1200),
      commonColors: readList('commonColors'),
      bodyFeatures: readList('bodyFeatures'),
      purchaseHistory: readList('purchaseHistory'),
      personaLabels: readList('personaLabels'),
      evidence: readList('evidence'),
      confidence: readBudget('confidence', 0),
      generatedAt: json['generatedAt'] is String
          ? DateTime.tryParse(json['generatedAt'] as String)
          : null,
    );
  }

  factory FashionProfile.fromUserData({
    required UserProfile profile,
    required UserPreference preference,
  }) {
    return FashionProfile(
      likedStyles: {
        ...profile.stylePreference,
        ...preference.likedStyles,
      }.toList(growable: false),
      likedBrands: profile.favoriteBrands,
      budgetMin: profile.budgetMin,
      budgetMax: profile.budgetMax,
      commonColors: {
        ...profile.favoriteColors,
        ...preference.likedColors,
      }.toList(growable: false),
      bodyFeatures: {
        profile.bodyType,
        ...preference.bodyFeatures,
      }.toList(growable: false),
      purchaseHistory: {
        ...profile.purchaseHistory,
        ...preference.purchaseHistory,
      }.toList(growable: false),
    );
  }

  final List<String> likedStyles;
  final List<String> likedBrands;
  final double budgetMin;
  final double budgetMax;
  final List<String> commonColors;
  final List<String> bodyFeatures;
  final List<String> purchaseHistory;
  final List<String> personaLabels;
  final List<String> evidence;
  final double confidence;
  final DateTime? generatedAt;

  bool isWithinBudget(String price) {
    final amount = double.tryParse(price.replaceAll(RegExp(r'[^0-9.]'), ''));
    return amount != null && amount >= budgetMin && amount <= budgetMax;
  }

  FashionProfile copyWith({
    List<String>? likedStyles,
    List<String>? likedBrands,
    double? budgetMin,
    double? budgetMax,
    List<String>? commonColors,
    List<String>? bodyFeatures,
    List<String>? purchaseHistory,
    List<String>? personaLabels,
    List<String>? evidence,
    double? confidence,
    DateTime? generatedAt,
  }) {
    return FashionProfile(
      likedStyles: likedStyles ?? this.likedStyles,
      likedBrands: likedBrands ?? this.likedBrands,
      budgetMin: budgetMin ?? this.budgetMin,
      budgetMax: budgetMax ?? this.budgetMax,
      commonColors: commonColors ?? this.commonColors,
      bodyFeatures: bodyFeatures ?? this.bodyFeatures,
      purchaseHistory: purchaseHistory ?? this.purchaseHistory,
      personaLabels: personaLabels ?? this.personaLabels,
      evidence: evidence ?? this.evidence,
      confidence: confidence ?? this.confidence,
      generatedAt: generatedAt ?? this.generatedAt,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'likedStyles': likedStyles,
      'likedBrands': likedBrands,
      'budgetMin': budgetMin,
      'budgetMax': budgetMax,
      'commonColors': commonColors,
      'bodyFeatures': bodyFeatures,
      'purchaseHistory': purchaseHistory,
      'personaLabels': personaLabels,
      'evidence': evidence,
      'confidence': confidence,
      'generatedAt': generatedAt?.toIso8601String(),
    };
  }
}
