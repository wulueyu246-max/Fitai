class UserProfile {
  const UserProfile({
    required this.height,
    required this.weight,
    this.age = 25,
    this.gender = '未设置',
    this.occupation = '城市职场',
    this.budgetMin = 100,
    this.budgetMax = 1200,
    this.sceneNeeds = const ['通勤', '约会', '旅行'],
    required this.bodyType,
    required this.stylePreference,
    required this.favoriteColors,
    required this.favoriteBrands,
    required this.purchaseHistory,
    required this.tryOnHistory,
    this.photos = const {},
    this.favoriteProductIds = const [],
    this.avatarBase64,
    this.outfitHistory = const [],
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    List<String> readList(String key) {
      return (json[key] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(growable: false);
    }

    double readDouble(String key, double fallback) {
      final value = json[key];
      if (value is num) {
        return value.toDouble();
      }
      return double.tryParse(value?.toString() ?? '') ?? fallback;
    }

    int readInt(String key, int fallback) {
      final value = json[key];
      if (value is num) {
        return value.toInt();
      }
      return int.tryParse(value?.toString() ?? '') ?? fallback;
    }

    return UserProfile(
      height: readDouble('height', 173),
      weight: readDouble('weight', 60),
      age: readInt('age', 25),
      gender: json['gender'] as String? ?? '未设置',
      occupation: json['occupation'] as String? ?? '城市职场',
      budgetMin: readDouble('budgetMin', 100),
      budgetMax: readDouble('budgetMax', 1200),
      sceneNeeds: readList('sceneNeeds'),
      bodyType: json['bodyType'] as String? ?? '偏瘦体型',
      stylePreference: readList('stylePreference'),
      favoriteColors: readList('favoriteColors'),
      favoriteBrands: readList('favoriteBrands'),
      purchaseHistory: readList('purchaseHistory'),
      tryOnHistory: readList('tryOnHistory'),
      photos: Map<String, String>.from(
        json['photos'] as Map<dynamic, dynamic>? ?? const {},
      ),
      favoriteProductIds: readList('favoriteProductIds'),
      avatarBase64: json['avatarBase64'] as String?,
      outfitHistory: readList('outfitHistory'),
    );
  }

  final double height;
  final double weight;
  final int age;
  final String gender;
  final String occupation;
  final double budgetMin;
  final double budgetMax;
  final List<String> sceneNeeds;
  final String bodyType;
  final List<String> stylePreference;
  final List<String> favoriteColors;
  final List<String> favoriteBrands;
  final List<String> purchaseHistory;
  final List<String> tryOnHistory;
  final Map<String, String> photos;
  final List<String> favoriteProductIds;
  final String? avatarBase64;
  final List<String> outfitHistory;

  UserProfile copyWith({
    double? height,
    double? weight,
    int? age,
    String? gender,
    String? occupation,
    double? budgetMin,
    double? budgetMax,
    List<String>? sceneNeeds,
    String? bodyType,
    List<String>? stylePreference,
    List<String>? favoriteColors,
    List<String>? favoriteBrands,
    List<String>? purchaseHistory,
    List<String>? tryOnHistory,
    Map<String, String>? photos,
    List<String>? favoriteProductIds,
    String? avatarBase64,
    List<String>? outfitHistory,
  }) {
    return UserProfile(
      height: height ?? this.height,
      weight: weight ?? this.weight,
      age: age ?? this.age,
      gender: gender ?? this.gender,
      occupation: occupation ?? this.occupation,
      budgetMin: budgetMin ?? this.budgetMin,
      budgetMax: budgetMax ?? this.budgetMax,
      sceneNeeds: sceneNeeds ?? this.sceneNeeds,
      bodyType: bodyType ?? this.bodyType,
      stylePreference: stylePreference ?? this.stylePreference,
      favoriteColors: favoriteColors ?? this.favoriteColors,
      favoriteBrands: favoriteBrands ?? this.favoriteBrands,
      purchaseHistory: purchaseHistory ?? this.purchaseHistory,
      tryOnHistory: tryOnHistory ?? this.tryOnHistory,
      photos: photos ?? this.photos,
      favoriteProductIds: favoriteProductIds ?? this.favoriteProductIds,
      avatarBase64: avatarBase64 ?? this.avatarBase64,
      outfitHistory: outfitHistory ?? this.outfitHistory,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'height': height,
      'weight': weight,
      'age': age,
      'gender': gender,
      'occupation': occupation,
      'budgetMin': budgetMin,
      'budgetMax': budgetMax,
      'sceneNeeds': sceneNeeds,
      'bodyType': bodyType,
      'stylePreference': stylePreference,
      'favoriteColors': favoriteColors,
      'favoriteBrands': favoriteBrands,
      'purchaseHistory': purchaseHistory,
      'tryOnHistory': tryOnHistory,
      'photos': photos,
      'favoriteProductIds': favoriteProductIds,
      'avatarBase64': avatarBase64,
      'outfitHistory': outfitHistory,
    };
  }
}
