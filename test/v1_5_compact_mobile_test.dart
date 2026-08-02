import 'package:fit_ai/features/home/services/daily_context_service.dart';
import 'package:fit_ai/features/user/pages/user_auth_page.dart';
import 'package:fit_ai/features/user/repositories/local_auth_repository.dart';
import 'package:fit_ai/features/user/services/user_session_controller.dart';
import 'package:fit_ai/pages/ai_outfit_page.dart';
import 'package:fit_ai/pages/home_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  Future<void> useCompactPhone(WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 568));
    addTearDown(() => tester.binding.setSurfaceSize(null));
  }

  testWidgets('compact home remains scrollable without layout errors', (
    tester,
  ) async {
    await useCompactPhone(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HomePage(
            onExploreAi: () {},
            onOpenProfile: () {},
            dailyContextService: const MockDailyContextService(
              delay: Duration.zero,
            ),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 700));

    expect(find.text('树皮'), findsOneWidget);
    final layoutError = tester.takeException();
    expect(
      layoutError,
      isNull,
      reason: layoutError is FlutterError
          ? layoutError.toStringDeep()
          : layoutError?.toString(),
    );
  });

  testWidgets('compact login supports switching to phone verification', (
    tester,
  ) async {
    await useCompactPhone(tester);
    final controller = UserSessionController(
      repository: LocalAuthRepository(),
    );
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(home: UserAuthPage(controller: controller)),
    );
    await tester.pump();
    await tester.tap(find.text('手机号'));
    await tester.pump();

    expect(find.byKey(const Key('auth-phone')), findsOneWidget);
    expect(find.byKey(const Key('auth-phone-code')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('compact AI upload page keeps all sections vertically scrollable',
      (
    tester,
  ) async {
    await useCompactPhone(tester);
    await tester.pumpWidget(const MaterialApp(home: AiOutfitPage()));
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('AI 穿搭'), findsOneWidget);
    expect(find.byKey(const Key('ai-height')), findsOneWidget);
    await tester.drag(
      find.byType(SingleChildScrollView).first,
      const Offset(0, -700),
    );
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
