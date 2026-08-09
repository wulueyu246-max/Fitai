import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('StyleProfile survives API parsing and serialization', () {
    final analysis = OutfitAnalysis.fromJson({
      'body_analysis': '比例均衡',
      'style': 'Clean Fit 御姐',
      'top': '短款针织',
      'bottom': '高腰阔腿裤',
      'shoes': '尖头低跟鞋',
      'accessories': '极简耳饰',
      'suggestion': '保持利落线条',
      'style_semantics': {
        'identity_impression': ['冷静'],
        'emotional_tone': ['克制'],
        'visual_personality': ['干净', '利落'],
        'social_signal': ['专业'],
        'must_express': ['成熟气场'],
        'must_avoid': ['夸张印花'],
        'style_atoms': ['极简', '结构'],
        'confidence': 0.86,
        'interpretation_summary': '干净克制并保留成熟气场。',
      },
      'style_profile': {
        'source_text': 'Clean Fit 御姐',
        'intent_priority_score': 93,
        'interpretation': '极简干净与成熟利落女性感的融合',
        'primary_style': 'Clean Fit',
        'secondary_styles': ['御姐'],
        'blend_rationale': '极简为主，成熟女性感为辅',
        'dimensions': {'minimalism': 88, 'femininity': 76},
        'silhouette': '短上长下的利落轮廓',
        'preferred_items': ['短款针织', '高腰阔腿裤'],
        'preferred_colors': ['黑色', '奶油白'],
        'preferred_materials': ['精纺针织'],
        'must_have': ['利落', '克制'],
        'must_avoid': ['繁复印花'],
        'positive_keywords': ['利落', '克制'],
        'negative_keywords': ['繁复印花'],
      },
    });

    expect(analysis.styleProfile.sourceText, 'Clean Fit 御姐');
    expect(analysis.styleProfile.intentPriorityScore, 93);
    expect(analysis.styleProfile.mustHave, ['利落', '克制']);
    expect(analysis.styleProfile.mustAvoid, ['繁复印花']);
    expect(analysis.styleProfile.secondaryStyles, ['御姐']);
    expect(analysis.styleProfile.dimensions['minimalism'], 88);
    expect(analysis.styleSemantics.mustAvoid, ['夸张印花']);
    expect(analysis.styleSemantics.confidence, 0.86);
    expect(
      analysis.toJson()['style_profile']['primary_style'],
      'Clean Fit',
    );
    expect(
      analysis.toJson()['style_profile']['intent_priority_score'],
      93,
    );
    expect(
      analysis.toJson()['style_semantics']['interpretation_summary'],
      '干净克制并保留成熟气场。',
    );
  });
}
