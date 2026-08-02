class UserAccount {
  const UserAccount({
    required this.id,
    required this.email,
    required this.displayName,
    required this.height,
    required this.weight,
    this.age = 25,
    this.gender = '未设置',
    required this.bodyType,
    required this.likedStyles,
    required this.budgetMin,
    required this.budgetMax,
    required this.favoriteBrands,
    required this.createdAt,
    this.avatarBase64,
    this.phone,
  });

  factory UserAccount.fromJson(Map<String, dynamic> json) {
    List<String> list(List<String> keys) {
      List<dynamic>? value;
      for (final key in keys) {
        if (json[key] case final List<dynamic> items) {
          value = items;
          break;
        }
      }
      return (value ?? const []).whereType<String>().toList(growable: false);
    }

    double number(String key, double fallback) {
      final value = json[key];
      return value is num
          ? value.toDouble()
          : double.tryParse(value?.toString() ?? '') ?? fallback;
    }

    final budget = json['budgetPreference'];
    double budgetNumber(String key, String nestedKey, double fallback) {
      final nested = budget is Map<dynamic, dynamic> ? budget[nestedKey] : null;
      final value = json[key] ?? nested;
      return value is num
          ? value.toDouble()
          : double.tryParse(value?.toString() ?? '') ?? fallback;
    }

    return UserAccount(
      id: (json['userId'] ?? json['id']) as String,
      email: json['email']?.toString() ?? '',
      phone: json['phone']?.toString(),
      displayName:
          (json['nickname'] ?? json['displayName']) as String? ?? '树皮用户',
      avatarBase64: (json['avatar'] ?? json['avatarBase64']) as String?,
      height: number('height', 173),
      weight: number('weight', 60),
      age: number('age', 25).round(),
      gender: json['gender'] as String? ?? '未设置',
      bodyType: json['bodyType'] as String? ?? '匀称体型',
      likedStyles: list(['stylePreference', 'likedStyles']),
      budgetMin: budgetNumber('budgetMin', 'min', 100),
      budgetMax: budgetNumber('budgetMax', 'max', 1200),
      favoriteBrands: list(['favoriteBrands']),
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.now(),
    );
  }

  final String id;
  final String email;
  final String? phone;
  final String displayName;
  final String? avatarBase64;
  final double height;
  final double weight;
  final int age;
  final String gender;
  final String bodyType;
  final List<String> likedStyles;
  final double budgetMin;
  final double budgetMax;
  final List<String> favoriteBrands;
  final DateTime createdAt;

  String get userId => id;
  String? get avatar => avatarBase64;
  String get nickname => displayName;
  List<String> get stylePreference => likedStyles;
  Map<String, double> get budgetPreference => {
        'min': budgetMin,
        'max': budgetMax,
      };

  UserAccount copyWith({
    String? displayName,
    String? avatarBase64,
    double? height,
    double? weight,
    int? age,
    String? gender,
    String? bodyType,
    List<String>? likedStyles,
    double? budgetMin,
    double? budgetMax,
    List<String>? favoriteBrands,
    bool clearAvatar = false,
    String? phone,
  }) {
    return UserAccount(
      id: id,
      email: email,
      phone: phone ?? this.phone,
      displayName: displayName ?? this.displayName,
      avatarBase64: clearAvatar ? null : avatarBase64 ?? this.avatarBase64,
      height: height ?? this.height,
      weight: weight ?? this.weight,
      age: age ?? this.age,
      gender: gender ?? this.gender,
      bodyType: bodyType ?? this.bodyType,
      likedStyles: likedStyles ?? this.likedStyles,
      budgetMin: budgetMin ?? this.budgetMin,
      budgetMax: budgetMax ?? this.budgetMax,
      favoriteBrands: favoriteBrands ?? this.favoriteBrands,
      createdAt: createdAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'phone': phone,
        'displayName': displayName,
        'avatarBase64': avatarBase64,
        'height': height,
        'weight': weight,
        'age': age,
        'gender': gender,
        'bodyType': bodyType,
        'likedStyles': likedStyles,
        'budgetMin': budgetMin,
        'budgetMax': budgetMax,
        'favoriteBrands': favoriteBrands,
        'createdAt': createdAt.toIso8601String(),
      };
}
