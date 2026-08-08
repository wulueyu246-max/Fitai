class StyleSemantics {
  const StyleSemantics({
    this.identityImpression = const [],
    this.emotionalTone = const [],
    this.visualPersonality = const [],
    this.socialSignal = const [],
    this.mustExpress = const [],
    this.mustAvoid = const [],
    this.styleAtoms = const [],
    this.confidence,
    this.interpretationSummary = '',
  });

  factory StyleSemantics.fromJson(dynamic value) {
    if (value is! Map) return const StyleSemantics();
    final json = Map<String, dynamic>.from(value);
    final rawConfidence = json['confidence'];
    return StyleSemantics(
      identityImpression: _strings(json['identity_impression']),
      emotionalTone: _strings(json['emotional_tone']),
      visualPersonality: _strings(json['visual_personality']),
      socialSignal: _strings(json['social_signal']),
      mustExpress: _strings(json['must_express']),
      mustAvoid: _strings(json['must_avoid']),
      styleAtoms: _strings(json['style_atoms']),
      confidence:
          rawConfidence is num ? rawConfidence.toDouble().clamp(0, 1) : null,
      interpretationSummary: _text(
        json['interpretation_summary'] ?? json['interpretationSummary'],
      ),
    );
  }

  final List<String> identityImpression;
  final List<String> emotionalTone;
  final List<String> visualPersonality;
  final List<String> socialSignal;
  final List<String> mustExpress;
  final List<String> mustAvoid;
  final List<String> styleAtoms;
  final double? confidence;
  final String interpretationSummary;

  Map<String, dynamic> toJson() => {
        'identity_impression': identityImpression,
        'emotional_tone': emotionalTone,
        'visual_personality': visualPersonality,
        'social_signal': socialSignal,
        'must_express': mustExpress,
        'must_avoid': mustAvoid,
        'style_atoms': styleAtoms,
        'confidence': confidence,
        'interpretation_summary': interpretationSummary,
      };

  static String _text(dynamic value) => value is String ? value.trim() : '';

  static List<String> _strings(dynamic value) => value is List
      ? List<String>.unmodifiable(
          value.whereType<String>().map((item) => item.trim()).where(
                (item) => item.isNotEmpty,
              ),
        )
      : const [];
}
