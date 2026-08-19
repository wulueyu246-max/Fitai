class StyleProfile {
  const StyleProfile({
    this.sourceText = '',
    this.intentPriorityScore = 60,
    this.interpretation = '',
    this.primaryStyle = '',
    this.secondaryStyles = const [],
    this.blendRationale = '',
    this.dimensions = const {},
    this.silhouette = '',
    this.preferredItems = const [],
    this.preferredColors = const [],
    this.preferredMaterials = const [],
    this.mustHave = const [],
    this.mustAvoid = const [],
    this.positiveKeywords = const [],
    this.negativeKeywords = const [],
  });

  factory StyleProfile.fromJson(dynamic value) {
    if (value is! Map) return const StyleProfile();
    final json = Map<String, dynamic>.from(value);
    return StyleProfile(
      sourceText: _text(json['source_text'] ?? json['sourceText']),
      intentPriorityScore: _score(
        json['intent_priority_score'] ?? json['intentPriorityScore'],
        fallback:
            _text(json['source_text'] ?? json['sourceText']).isEmpty ? 60 : 90,
      ),
      interpretation: _text(json['interpretation']),
      primaryStyle: _text(json['primary_style'] ?? json['primaryStyle']),
      secondaryStyles: _strings(
        json['secondary_styles'] ?? json['secondaryStyles'],
      ),
      blendRationale: _text(
        json['blend_rationale'] ?? json['blendRationale'],
      ),
      dimensions: _dimensions(json['dimensions']),
      silhouette: _text(json['silhouette']),
      preferredItems: _strings(
        json['preferred_items'] ?? json['preferredItems'],
      ),
      preferredColors: _strings(
        json['preferred_colors'] ?? json['preferredColors'],
      ),
      preferredMaterials: _strings(
        json['preferred_materials'] ?? json['preferredMaterials'],
      ),
      mustHave: _strings(
        json['must_have'] ??
            json['mustHave'] ??
            json['positive_keywords'] ??
            json['positiveKeywords'],
      ),
      mustAvoid: _strings(
        json['must_avoid'] ??
            json['mustAvoid'] ??
            json['negative_keywords'] ??
            json['negativeKeywords'],
      ),
      positiveKeywords: _strings(
        json['positive_keywords'] ?? json['positiveKeywords'],
      ),
      negativeKeywords: _strings(
        json['negative_keywords'] ?? json['negativeKeywords'],
      ),
    );
  }

  final String sourceText;
  final int intentPriorityScore;
  final String interpretation;
  final String primaryStyle;
  final List<String> secondaryStyles;
  final String blendRationale;
  final Map<String, int> dimensions;
  final String silhouette;
  final List<String> preferredItems;
  final List<String> preferredColors;
  final List<String> preferredMaterials;
  final List<String> mustHave;
  final List<String> mustAvoid;
  final List<String> positiveKeywords;
  final List<String> negativeKeywords;

  Map<String, dynamic> toJson() => {
        'source_text': sourceText,
        'intent_priority_score': intentPriorityScore,
        'interpretation': interpretation,
        'primary_style': primaryStyle,
        'secondary_styles': secondaryStyles,
        'blend_rationale': blendRationale,
        'dimensions': dimensions,
        'silhouette': silhouette,
        'preferred_items': preferredItems,
        'preferred_colors': preferredColors,
        'preferred_materials': preferredMaterials,
        'must_have': mustHave,
        'must_avoid': mustAvoid,
        'positive_keywords': positiveKeywords,
        'negative_keywords': negativeKeywords,
      };

  static String _text(dynamic value) => value is String ? value.trim() : '';

  static int _score(dynamic value, {required int fallback}) {
    final number = value is num ? value : num.tryParse(value?.toString() ?? '');
    return (number ?? fallback).round().clamp(0, 100);
  }

  static List<String> _strings(dynamic value) => value is List
      ? List<String>.unmodifiable(
          value.whereType<String>().map((item) => item.trim()).where(
                (item) => item.isNotEmpty,
              ),
        )
      : const [];

  static Map<String, int> _dimensions(dynamic value) {
    if (value is! Map) return const {};
    final result = <String, int>{};
    for (final entry in value.entries) {
      final number = entry.value is num ? entry.value as num : null;
      if (number == null) continue;
      result[entry.key.toString()] = number.round().clamp(0, 100);
    }
    return Map<String, int>.unmodifiable(result);
  }
}
