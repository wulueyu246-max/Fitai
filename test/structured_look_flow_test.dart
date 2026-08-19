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
            'style_direction': index == 1
                ? '日系极简'
                : index == 2
                    ? '韩系高级'
                    : '轻商务',
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
    expect(
      analysis.looks.map((look) => look.styleDirection).toSet(),
      hasLength(3),
    );
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

  test('preserves Styling Strategy and Look proportion goals for product AI',
      () {
    final analysis = OutfitAnalysis.fromJson({
      'request_id': 'stylist-v2-request',
      'gender': 'female',
      'bodyProfile': '160cm，照片显示腿部视觉比例需要优化',
      'style': '法式约会',
      'styling_strategy': {
        'body_strengths': ['肩颈线条清晰'],
        'proportion_issues': ['腿部视觉比例偏短'],
        'visual_goals': ['raise_visual_waistline', 'elongate_legs'],
        'waistline_strategy': '提高视觉腰线',
        'top_length_strategy': '短款或塞衣角',
        'bottom_strategy': '高腰并控制裙裤长度',
        'shoe_strategy': '舒适的浅口杏仁头或低跟鞋',
        'color_strategy': '下装与鞋保持颜色连续',
        'silhouette_strategy': '建立轻盈纵向线条',
        'skin_exposure_strategy': '适度露出脚踝',
        'accessory_strategy': '配饰保持小体积',
        'weather_strategy': '夏季使用透气材质',
      },
      'recommendations': {
        'top': '短款针织衫',
        'bottom': '高腰A字裙',
        'shoes': '杏仁头低跟鞋',
        'accessories': '小体积包袋',
        'summary': '提高腰线并延长腿部视觉线条',
      },
      'looks': [
        for (var index = 1; index <= 3; index += 1)
          {
            'request_id': 'stylist-v2-request',
            'look_id': 'stylist-look-$index',
            'gender': 'female',
            'scene': 'date',
            'style': '法式约会',
            'style_direction': '比例方向 $index',
            'styling_goal': '提高视觉腰线',
            'proportion_strategy': '短上衣、高腰下装与浅口鞋连续',
            'why_this_changes_the_body_proportion': '提高腰线并增加可见腿长',
            'items': [
              {
                'category': 'top',
                'gender': 'female',
                'item_name': '短款针织衫',
                'search_keywords': ['女士 短款 针织衫'],
              },
              {
                'category': 'bottom',
                'gender': 'female',
                'item_name': '高腰A字裙',
                'search_keywords': ['女士 高腰 A字裙'],
              },
              {
                'category': 'shoes',
                'gender': 'female',
                'item_name': '杏仁头低跟鞋',
                'search_keywords': ['女士 杏仁头 低跟鞋'],
              },
            ],
          },
      ],
    });

    expect(
      analysis.stylingStrategy.visualGoals,
      ['raise_visual_waistline', 'elongate_legs'],
    );
    expect(analysis.looks.first.stylingGoal, '提高视觉腰线');
    expect(
      analysis.looks.first.toJson()['proportion_strategy'],
      '短上衣、高腰下装与浅口鞋连续',
    );
    expect(
      (analysis.toJson()['styling_strategy']
          as Map<String, dynamic>)['shoe_strategy'],
      '舒适的浅口杏仁头或低跟鞋',
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
    expect(find.textContaining('上衣 ·'), findsNWidgets(3));
    expect(find.textContaining('下装 ·'), findsNWidgets(3));
    expect(find.textContaining('鞋履 ·'), findsNWidgets(3));
    expect(find.textContaining('top ·'), findsNothing);
    expect(find.textContaining('bottom ·'), findsNothing);
    expect(find.textContaining('shoes ·'), findsNothing);
    expect(find.text('日系极简'), findsOneWidget);
    expect(find.text('造型建议'), findsNWidgets(3));
    expect(
      find.text('本套 Look 无需帽子，保持极简轮廓，不增加多余视觉重量'),
      findsNWidgets(3),
    );
  });

  test('American vintage keeps a hat while Clean Fit removes it', () {
    Map<String, dynamic> lookJson({required bool includeHat}) => {
          'request_id': includeHat ? 'vintage-request' : 'clean-request',
          'look_id': includeHat ? 'vintage-look' : 'clean-look',
          'gender': 'male',
          'scene': 'date',
          'style': includeHat ? '美式复古' : 'Clean Fit 极简',
          'accessories_decision': [
            {
              'category': 'hat',
              'include': includeHat,
              'reason': includeHat ? '强化美式复古轮廓' : '保持极简轮廓',
            },
          ],
          'items': [
            {
              'category': 'top',
              'gender': 'male',
              'item_name': '复古衬衫',
              'search_keywords': ['男士 复古 衬衫'],
            },
            {
              'category': 'bottom',
              'gender': 'male',
              'item_name': '直筒裤',
              'search_keywords': ['男士 复古 直筒裤'],
            },
            {
              'category': 'shoes',
              'gender': 'male',
              'item_name': '工装靴',
              'search_keywords': ['男士 复古 工装靴'],
            },
            {
              'category': 'hat',
              'gender': 'male',
              'item_name': '复古牛仔帽',
              'search_keywords': ['男士 牛仔帽 复古', '美式街头帽'],
            },
          ],
        };

    final vintage = OutfitLook.fromJson(lookJson(includeHat: true));
    final cleanFit = OutfitLook.fromJson(lookJson(includeHat: false));

    expect(vintage.items.any((item) => item.category == 'hat'), isTrue);
    expect(cleanFit.items.any((item) => item.category == 'hat'), isFalse);
    expect(vintage.accessoryDecisions.single.include, isTrue);
    expect(cleanFit.accessoryDecisions.single.include, isFalse);
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
    accessoryDecisions: const [
      AccessoryDecision(
        category: 'hat',
        include: false,
        reason: '保持极简轮廓，不增加多余视觉重量',
      ),
    ],
    styleDirection: lookId.endsWith('1')
        ? '日系极简'
        : lookId.endsWith('2')
            ? '韩系高级'
            : '轻商务',
    items: [
      item('top', gender == 'male' ? '短袖Polo' : '短款针织衫'),
      item('bottom', gender == 'male' ? '九分休闲裤' : '高腰阔腿裤'),
      item('shoes', gender == 'male' ? '德训鞋' : '玛丽珍鞋'),
      item('accessory', gender == 'male' ? '腕表' : '腋下包'),
    ],
  );
}
