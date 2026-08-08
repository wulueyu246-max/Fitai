class StylingStrategy {
  const StylingStrategy({
    this.bodyStrengths = const [],
    this.proportionIssues = const [],
    this.visualGoals = const [],
    this.waistlineStrategy = '',
    this.topLengthStrategy = '',
    this.bottomStrategy = '',
    this.shoeStrategy = '',
    this.colorStrategy = '',
    this.silhouetteStrategy = '',
    this.skinExposureStrategy = '',
    this.accessoryStrategy = '',
    this.weatherStrategy = '',
  });

  factory StylingStrategy.fromJson(Map<String, dynamic> json) {
    return StylingStrategy(
      bodyStrengths: _strings(json['body_strengths'] ?? json['bodyStrengths']),
      proportionIssues:
          _strings(json['proportion_issues'] ?? json['proportionIssues']),
      visualGoals: _strings(json['visual_goals'] ?? json['visualGoals']),
      waistlineStrategy:
          _string(json['waistline_strategy'] ?? json['waistlineStrategy']),
      topLengthStrategy:
          _string(json['top_length_strategy'] ?? json['topLengthStrategy']),
      bottomStrategy:
          _string(json['bottom_strategy'] ?? json['bottomStrategy']),
      shoeStrategy: _string(json['shoe_strategy'] ?? json['shoeStrategy']),
      colorStrategy: _string(json['color_strategy'] ?? json['colorStrategy']),
      silhouetteStrategy:
          _string(json['silhouette_strategy'] ?? json['silhouetteStrategy']),
      skinExposureStrategy: _string(
        json['skin_exposure_strategy'] ?? json['skinExposureStrategy'],
      ),
      accessoryStrategy:
          _string(json['accessory_strategy'] ?? json['accessoryStrategy']),
      weatherStrategy:
          _string(json['weather_strategy'] ?? json['weatherStrategy']),
    );
  }

  final List<String> bodyStrengths;
  final List<String> proportionIssues;
  final List<String> visualGoals;
  final String waistlineStrategy;
  final String topLengthStrategy;
  final String bottomStrategy;
  final String shoeStrategy;
  final String colorStrategy;
  final String silhouetteStrategy;
  final String skinExposureStrategy;
  final String accessoryStrategy;
  final String weatherStrategy;

  bool get isEmpty =>
      bodyStrengths.isEmpty &&
      proportionIssues.isEmpty &&
      visualGoals.isEmpty &&
      waistlineStrategy.isEmpty &&
      topLengthStrategy.isEmpty &&
      bottomStrategy.isEmpty &&
      shoeStrategy.isEmpty &&
      colorStrategy.isEmpty &&
      silhouetteStrategy.isEmpty &&
      skinExposureStrategy.isEmpty &&
      accessoryStrategy.isEmpty &&
      weatherStrategy.isEmpty;

  Map<String, dynamic> toJson() => {
        'body_strengths': bodyStrengths,
        'proportion_issues': proportionIssues,
        'visual_goals': visualGoals,
        'waistline_strategy': waistlineStrategy,
        'top_length_strategy': topLengthStrategy,
        'bottom_strategy': bottomStrategy,
        'shoe_strategy': shoeStrategy,
        'color_strategy': colorStrategy,
        'silhouette_strategy': silhouetteStrategy,
        'skin_exposure_strategy': skinExposureStrategy,
        'accessory_strategy': accessoryStrategy,
        'weather_strategy': weatherStrategy,
      };

  static String _string(Object? value) => value?.toString().trim() ?? '';

  static List<String> _strings(Object? value) {
    if (value is! List) return const [];
    return List<String>.unmodifiable(
      value
          .whereType<String>()
          .map((item) => item.trim())
          .where((item) => item.isNotEmpty),
    );
  }
}
