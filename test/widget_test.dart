import 'package:fit_ai/main.dart';
import 'package:fit_ai/services/onboarding_service.dart';
import 'package:fit_ai/models/app_location.dart';
import 'package:fit_ai/services/location_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows four navigation destinations and changes pages',
      (tester) async {
    await tester.pumpWidget(
      FitAIApp(
        onboardingService: MemoryOnboardingService(completed: true),
        locationService: _ReadyLocationService(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('树皮 Shupi'), findsOneWidget);
    expect(find.text('今日AI穿搭推荐'), findsOneWidget);
    expect(find.text('首页'), findsOneWidget);
    expect(find.text('AI穿搭'), findsOneWidget);
    expect(find.text('我的衣柜'), findsWidgets);
    expect(find.text('账户中心'), findsOneWidget);

    await tester.tap(find.text('AI穿搭'));
    await tester.pumpAndSettle();
    expect(find.textContaining('商务会议'), findsOneWidget);
    expect(find.text('✦ 生成我的穿搭方案'), findsOneWidget);

    await tester.tap(find.text('我的衣柜'));
    await tester.pumpAndSettle();
    expect(find.text('我的收藏'), findsOneWidget);

    await tester.tap(find.text('账户中心'));
    await tester.pumpAndSettle();
    expect(find.text('用户名'), findsOneWidget);
    expect(find.text('会员等级'), findsNothing);
    expect(find.byKey(const Key('open-brand-partner-center')), findsNothing);
    expect(find.byKey(const Key('open-affiliate-revenue')), findsNothing);
    expect(find.byKey(const Key('open-wardrobe')), findsOneWidget);

    final wardrobeEntry = find.byKey(const Key('open-wardrobe'));
    await tester.ensureVisible(wardrobeEntry);
    await tester.pumpAndSettle();
    await tester.tap(wardrobeEntry);
    await tester.pumpAndSettle();
    expect(find.text('我的衣柜'), findsWidgets);
    expect(find.text('我的收藏'), findsOneWidget);
    expect(find.text('我的穿搭'), findsOneWidget);
    expect(find.text('试穿记录'), findsOneWidget);
    expect(find.text('AI建议'), findsOneWidget);
  });
}

class _ReadyLocationService implements LocationService {
  final location = AppLocation(
    country: '中国',
    city: '上海',
    latitude: 31.23,
    longitude: 121.47,
    source: 'manual',
    updatedAt: DateTime(2026),
  );

  @override
  Future<AppLocation?> load() async => location;

  @override
  Future<AppLocation> resolveCity(String city) async => location;

  @override
  Future<void> save(AppLocation value) async {}

  @override
  Future<AppLocation> useDeviceLocation() async => location;
}
