class UserPreference {
  const UserPreference({
    required this.likedStyles,
    required this.likedColors,
    required this.bodyFeatures,
    required this.purchaseHistory,
    required this.browsingHistory,
  });

  factory UserPreference.fromJson(Map<String, dynamic> json) {
    List<String> readList(String key) {
      return (json[key] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(growable: false);
    }

    return UserPreference(
      likedStyles: readList('likedStyles'),
      likedColors: readList('likedColors'),
      bodyFeatures: readList('bodyFeatures'),
      purchaseHistory: readList('purchaseHistory'),
      browsingHistory: readList('browsingHistory'),
    );
  }

  final List<String> likedStyles;
  final List<String> likedColors;
  final List<String> bodyFeatures;
  final List<String> purchaseHistory;
  final List<String> browsingHistory;

  UserPreference copyWith({
    List<String>? likedStyles,
    List<String>? likedColors,
    List<String>? bodyFeatures,
    List<String>? purchaseHistory,
    List<String>? browsingHistory,
  }) {
    return UserPreference(
      likedStyles: likedStyles ?? this.likedStyles,
      likedColors: likedColors ?? this.likedColors,
      bodyFeatures: bodyFeatures ?? this.bodyFeatures,
      purchaseHistory: purchaseHistory ?? this.purchaseHistory,
      browsingHistory: browsingHistory ?? this.browsingHistory,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'likedStyles': likedStyles,
      'likedColors': likedColors,
      'bodyFeatures': bodyFeatures,
      'purchaseHistory': purchaseHistory,
      'browsingHistory': browsingHistory,
    };
  }
}
