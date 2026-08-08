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
      'style_profile': {
        'source_text': 'Clean Fit 御姐',
        'interpretation': '极简干净与成熟利落女性感的融合',
        'primary_style': 'Clean Fit',
        'secondary_styles': ['御姐'],
        'blend_rationale': '极简为主，成熟女性感为辅',
        'dimensions': {'minimalism': 88, 'femininity': 76},
        'silhouette': '短上长下的利落轮廓',
        'preferred_items': ['短款针织', '高腰阔腿裤'],
        'preferred_colors': ['黑色', '奶油白'],
        'preferred_materials': ['精纺针织'],
        'positive_keywords': ['利落', '克制'],
        'negative_keywords': ['繁复印花'],
      },
    });

    expect(analysis.styleProfile.sourceText, 'Clean Fit 御姐');
    expect(analysis.styleProfile.secondaryStyles, ['御姐']);
    expect(analysis.styleProfile.dimensions['minimalism'], 88);
    expect(
      analysis.toJson()['style_profile']['primary_style'],
      'Clean Fit',
    );
  });
}
