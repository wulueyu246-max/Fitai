import 'package:fit_ai/components/outfit_plan_card.dart';
import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:fit_ai/models/outfit_look.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/models/product_search_requirement.dart';
import 'package:fit_ai/services/recommendation_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses three AI Looks before exposing product search requirements', () {
    Map<String, dynamic> item(String category, String name, String color) => {
          'category': category,
          'gender': 'male',
          'item_name': name,
          'color': color,
          'fit': '合体',
          'material': '棉混纺',
          'style': 'Clean Fit',
          'season': 'summer',
          'scene': 'date',
          'search_keywords': ['男士 $color $name'],
          'negative_keywords': ['女装', '吊带', '裙'],
        };
    final analysis = OutfitAnalysis.fromJson({
      'request_id': 'request-clean-fit',
      'gender': 'male',
      'bodyProfile': '男性身体比例分析',
      'style': 'Clean Fit',
      'recommendations': {
        'top': '浅灰 Polo',
        'bottom': '米白休闲裤',
        'shoes': '白色德训鞋',
        'accessories': '简约腕表',
        'summary': '夏季约会完整搭配',
      },
      'looks': [
        for (var index = 1; index <= 3; index += 1)
          {
            'request_id': 'request-clean-fit',
            'look_id': 'clean-look-$index',
            'gender': 'male',
            'scene': 'date',
            'style': 'Clean Fit',
            'items': [
              item('top', '浅灰色短袖Polo', '浅灰色'),
              item('bottom', '九分休闲裤', '米白色'),
              item('shoes', '德训鞋', '白色'),
              item('accessory', '简约腕表', '银色'),
            ],
          },
      ],
    });

    expect(analysis.looks, hasLength(3));
    expect(analysis.productRequirements, hasLength(12));
    expect(
      analysis.looks.every(
        (look) => look.matches(
          requestId: 'request-clean-fit',
          gender: 'male',
        ),
      ),
      isTrue,
    );
    expect(
      analysis.productRequirements.every(
        (item) =>
            item.gender == 'male' &&
            item.lookId.startsWith('clean-look-') &&
            item.searchKeywords.every((keyword) => keyword.startsWith('男士')),
      ),
      isTrue,
    );
  });

  for (final gender in const ['male', 'female']) {
    test('$gender products can only build plans for their own AI Looks', () {
      const service = RecommendationService();
      final requestId = 'request-$gender';
      final looks = [
        for (var index = 1; index <= 3; index += 1)
          _look(
            lookId: '$gender-look-$index',
            requestId: requestId,
            gender: gender,
            style: gender == 'male' ? 'Clean Fit' : '法式',
          ),
      ];
      final products = [
        for (final look in looks)
          for (final category in const [
            ProductCategory.top,
            ProductCategory.bottom,
            ProductCategory.shoes,
            ProductCategory.accessories,
          ])
            MockProductDatabase.products
                .firstWhere(
                  (product) => product.wardrobeSlot == category,
                )
                .copyWith(
                  id: '${look.lookId}-$category',
                  sku: '${look.lookId}-$category',
                  lookId: look.lookId,
                  requestId: requestId,
                ),
      ];

      final plans = service.buildOutfitPlans(
        products: products,
        looks: looks,
        requestId: requestId,
        gender: gender,
        createdTime: DateTime(2026, 8, 7),
      );

      expect(plans, hasLength(3));
      expect(
        plans.every(
          (plan) =>
              plan.matchesCurrentResult(
                requestId: requestId,
                gender: gender,
              ) &&
              plan.products.every((product) => product.lookId == plan.lookId),
        ),
        isTrue,
      );
    });
  }

  testWidgets('renders three complete AI Looks as separate cards',
      (tester) async {
    const service = RecommendationService();
    const requestId = 'request-three-looks';
    final looks = [
      for (var index = 1; index <= 3; index += 1)
        _look(
          lookId: 'look-$index',
          requestId: requestId,
          gender: 'male',
          style: 'Clean Fit $index',
        ),
    ];
    final products = [
      for (final look in looks)
        for (final category in const [
          ProductCategory.top,
          ProductCategory.bottom,
          ProductCategory.shoes,
        ])
          MockProductDatabase.products
              .firstWhere((product) => product.wardrobeSlot == category)
              .copyWith(
                id: '${look.lookId}-$category',
                sku: '${look.lookId}-$category',
                lookId: look.lookId,
              ),
    ];
    final plans = service.buildOutfitPlans(
      products: products,
      looks: looks,
      requestId: requestId,
      gender: 'male',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: Column(
              children: [
                for (final plan in plans)
                  OutfitPlanCard(
                    plan: plan,
                    favorite: false,
                    onFavorite: () {},
                    onProductTap: (_) {},
                  ),
              ],
            ),
          ),
        ),
      ),
    );

    expect(find.byType(OutfitPlanCard), findsNWidgets(3));
  });
}

OutfitLook _look({
  required String lookId,
  required String requestId,
  required String gender,
  required String style,
}) {
  ProductSearchRequirement item(String category, String name) =>
      ProductSearchRequirement(
        lookId: lookId,
        category: category,
        gender: gender,
        itemName: name,
        color: '中性色',
        fit: '合体',
        material: '棉混纺',
        style: style,
        season: 'summer',
        scene: 'date',
        searchKeywords: [
          '${gender == 'male' ? '男士' : '女士'} 中性色 $name',
        ],
        negativeKeywords: gender == 'male' ? ['女装'] : ['男装'],
      );
  return OutfitLook(
    lookId: lookId,
    requestId: requestId,
    gender: gender,
    scene: 'date',
    style: style,
    items: [
      item('top', gender == 'male' ? '短袖Polo' : '短款针织衫'),
      item('bottom', gender == 'male' ? '九分休闲裤' : '高腰阔腿裤'),
      item('shoes', gender == 'male' ? '德训鞋' : '玛丽珍鞋'),
      item('accessory', gender == 'male' ? '腕表' : '腋下包'),
    ],
  );
}
