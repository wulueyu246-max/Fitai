import 'package:fit_ai/components/outfit_post_card.dart';
import 'package:fit_ai/pages/home_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders the inspiration home and opens AI styling', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    var openedAi = false;
    var openedProfile = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HomePage(
            onExploreAi: () => openedAi = true,
            onOpenProfile: () => openedProfile = true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('树皮 Shupi'), findsOneWidget);
    expect(find.text('搜索风格、商品、穿搭'), findsOneWidget);
    expect(find.text('通勤'), findsWidgets);
    expect(find.byKey(const Key('fashion-scene-carousel')), findsOneWidget);
    expect(find.text('今日AI穿搭推荐'), findsOneWidget);
    expect(find.textContaining('25℃ 多云'), findsWidgets);

    await tester.tap(find.text('生成我的方案'));
    expect(openedAi, isTrue);

    await tester.ensureVisible(find.text('热门AI Look'));
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('热门AI Look'), findsOneWidget);
    expect(find.text('173cm身材比例优化方案'), findsWidgets);

    final firstFeedCard = find.byType(OutfitPostCard).first;
    expect(tester.getSize(firstFeedCard).width, lessThan(180));

    await tester.tap(
      find.byKey(const Key('favorite-post-commute-proportion')),
    );
    await tester.pump();
    expect(find.textContaining('已收藏'), findsOneWidget);

    await tester.ensureVisible(find.text('适合我的'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('适合我的'), findsOneWidget);

    await tester.ensureVisible(find.text('品牌专区'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('品牌专区'), findsOneWidget);

    final profileButton = find.byKey(const Key('home-profile-button'));
    await tester.ensureVisible(profileButton);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(profileButton);
    expect(openedProfile, isTrue);
  });

  testWidgets('filters mock inspirations with local search', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HomePage(
            onExploreAi: () {},
            onOpenProfile: () {},
          ),
        ),
      ),
    );

    await tester.enterText(find.byType(TextField), '不存在的风格');
    await tester.pump(const Duration(milliseconds: 500));

    await tester.ensureVisible(find.text('没有匹配的AI Look'));
    expect(find.text('没有匹配的AI Look'), findsOneWidget);

    await tester.ensureVisible(find.text('没有匹配的商品'));
    expect(find.text('没有匹配的商品'), findsOneWidget);
  });

  testWidgets('switches fashion scene and hides experimental challenge', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var openedAi = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HomePage(
            onExploreAi: () => openedAi = true,
            onOpenProfile: () {},
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 700));

    await tester.drag(
      find.byKey(const Key('fashion-scene-carousel')),
      const Offset(-500, 0),
    );
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.byKey(const Key('scene-interview')));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('面试 · AI分析与关联商品'), findsOneWidget);

    expect(find.byKey(const Key('join-outfit-challenge')), findsNothing);
    expect(openedAi, isFalse);
  });
}
