import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses Shopping Agent candidate-backed products and two OutfitPlans',
      () {
    final analysis = OutfitAnalysis.fromJson({
      'bodyProfile': '纤细',
      'style': '清新休闲',
      'gender': 'female',
      'request_id': 'request-agent-1',
      'recommendations': {
        'top': '真实上衣',
        'bottom': '真实下装',
        'shoes': '真实鞋履',
        'accessories': '无需配饰',
        'summary': '真实商品组合',
        'products': [
          _product('top', 1),
          _product('bottom', 1),
          _product('shoes', 1)
        ],
      },
      'products': [],
      'looks': [],
      'shopping_agent_status': 'success',
      'shopping_agent_retryable': false,
      'shopping_agent_products': [
        for (final index in [1, 2]) ...[
          _product('top', index),
          _product('bottom', index),
          _product('shoes', index),
        ],
      ],
      'outfit_plans': [
        _plan(1),
        _plan(2),
      ],
      'outfit_plan': _plan(1),
    });

    expect(analysis.hasShoppingAgentResult, isTrue);
    expect(analysis.recommendedProducts, hasLength(6));
    expect(analysis.outfitPlans, hasLength(2));
    expect(analysis.outfitPlans.first.top.id, 'candidate-top-1');
    expect(
      analysis.outfitPlans.first.top.purchaseUrl,
      'https://item.example/top-1',
    );
  });

  test('parses explicit Shopping Agent failure state', () {
    final analysis = OutfitAnalysis.fromJson({
      'bodyProfile': '纤细',
      'style': '清新休闲',
      'gender': 'female',
      'request_id': 'request-agent-failed',
      'recommendations': {
        'top': '上衣',
        'bottom': '下装',
        'shoes': '鞋履',
        'accessories': '配饰',
        'summary': '总结',
        'products': [],
      },
      'products': [],
      'looks': [],
      'shopping_agent_status': 'failed',
      'shopping_agent_first_failure_stage': 'product_selector',
      'shopping_agent_retryable': true,
      'shopping_agent_products': [],
      'outfit_plans': [],
    });

    expect(analysis.hasShoppingAgentFailure, isTrue);
    expect(analysis.shoppingAgentFirstFailureStage, 'product_selector');
    expect(analysis.shoppingAgentRetryable, isTrue);
  });
}

Map<String, dynamic> _product(String slot, int index) => {
      'id': 'candidate-$slot-$index',
      'candidate_id': 'candidate-$slot-$index',
      'product_id': 'candidate-$slot-$index',
      'title': '$slot 商品 $index',
      'name': '$slot 商品 $index',
      'category': slot,
      'image_url': 'https://img.example/$slot-$index.jpg',
      'price': 129,
      'purchase_url': 'https://item.example/$slot-$index',
      'affiliate_url': 'https://item.example/$slot-$index',
      'detail_url': 'https://item.example/$slot-$index',
      'platform': 'taobao',
      'source': 'taobao',
      'stock_status': 'in_stock',
      'is_mock': false,
      'request_id': 'request-agent-1',
      'look_id': 'look-$index',
    };

Map<String, dynamic> _plan(int index) => {
      'id': 'plan-$index',
      'title': '真实商品 Look $index',
      'top': _product('top', index),
      'bottom': _product('bottom', index),
      'shoes': _product('shoes', index),
      'reason': '真实候选组合',
      'createdTime': '2026-08-17T00:00:00.000Z',
      'scene': '出去玩',
      'style': '清新休闲',
      'gender': 'female',
      'request_id': 'request-agent-1',
      'look_id': 'look-$index',
      'matchScore': 80,
    };
