class FirstLaunchProfile {
  const FirstLaunchProfile({
    required this.gender,
    required this.height,
    required this.weight,
    required this.ageRange,
    required this.occupation,
    required this.scene,
  });

  factory FirstLaunchProfile.fromJson(Map<String, dynamic> json) {
    double number(String key, double fallback) {
      final value = json[key];
      return value is num
          ? value.toDouble()
          : double.tryParse(value?.toString() ?? '') ?? fallback;
    }

    return FirstLaunchProfile(
      gender: json['gender'] as String? ?? '未设置',
      height: number('height', 173),
      weight: number('weight', 60),
      ageRange: json['ageRange'] as String? ?? '25-34',
      occupation: json['occupation'] as String? ?? '城市职场',
      scene: json['scene'] as String? ?? '日常',
    );
  }

  final String gender;
  final double height;
  final double weight;
  final String ageRange;
  final String occupation;
  final String scene;

  int get representativeAge {
    final first = int.tryParse(ageRange.split('-').first);
    return first == null ? 25 : first + 4;
  }

  Map<String, dynamic> toJson() {
    return {
      'gender': gender,
      'height': height,
      'weight': weight,
      'ageRange': ageRange,
      'occupation': occupation,
      'scene': scene,
    };
  }
}
