import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Outfit Blueprint survives API parsing and serialization', () {
    final analysis = OutfitAnalysis.fromJson({
      'request_id': 'blueprint-request',
      'gender': 'female',
      'bodyProfile': '身体比例分析',
      'style': '用户自然语言风格',
      'outfit_blueprint': {
        'blueprint_source': 'semantic_fallback',
        'style_identity': '浪漫精致造型',
        'character_impression': '轻盈且具有完整造型感',
        'visual_keywords': ['浪漫', '精致'],
        'core_elements': ['蕾丝', '蝴蝶结'],
        'silhouette_strategy': ['明确腰线'],
        'color_palette': ['奶白色'],
        'material_direction': ['蕾丝'],
        'must_have_items': {
          'top': ['蕾丝上衣'],
          'bottom': ['高腰裙'],
          'socks': ['白丝袜'],
          'shoes': ['玛丽珍皮鞋'],
        },
        'avoid_items': ['运动鞋'],
        'occasion_strategy': '适合日常约会',
      },
      'recommendations': {
        'top': '蕾丝上衣',
        'bottom': '高腰裙',
        'shoes': '玛丽珍皮鞋',
        'accessories': '精致小包',
        'summary': '完整造型',
      },
      'looks': [
        {
          'request_id': 'blueprint-request',
          'look_id': 'look-1',
          'gender': 'female',
          'scene': '约会',
          'style': '浪漫精致造型',
          'items': [
            {
              'category': 'top',
              'gender': 'female',
              'item_name': '蕾丝上衣',
              'color': '奶白色',
              'style': '浪漫',
              'season': 'summer',
              'scene': '约会',
              'search_keywords': ['女士 奶白色 蕾丝上衣'],
              'negative_keywords': ['运动风'],
              'blueprint_required': true,
              'query_reason': '根据穿搭蓝图中的具体单品生成',
              'source_elements': ['蕾丝上衣', '蕾丝'],
              'translated_queries': [
                {
                  'category': 'top',
                  'query': '女士 蕾丝 荷叶边 上衣',
                  'source_elements': ['蕾丝上衣', '蕾丝'],
                  'query_reason': '根据穿搭蓝图中的具体单品生成',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(analysis.outfitBlueprint.styleIdentity, '浪漫精致造型');
    expect(analysis.outfitBlueprint.blueprintSource, 'semantic_fallback');
    expect(
      analysis.outfitBlueprint.mustHaveItems['shoes'],
      ['玛丽珍皮鞋'],
    );
    expect(analysis.productRequirements.single.blueprintRequired, isTrue);
    expect(
      analysis.productRequirements.single.queryReason,
      '根据穿搭蓝图中的具体单品生成',
    );
    expect(
      analysis.productRequirements.single.sourceElements,
      ['蕾丝上衣', '蕾丝'],
    );
    expect(
      analysis.productRequirements.single.translatedQueries.single.query,
      '女士 蕾丝 荷叶边 上衣',
    );
    expect(
      analysis.productRequirements.single.toJson()['translated_queries'],
      isNotEmpty,
    );
    expect(
      analysis.toJson()['outfit_blueprint']['avoid_items'],
      ['运动鞋'],
    );
  });
}
