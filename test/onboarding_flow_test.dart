import 'package:fit_ai/main.dart';
import 'package:fit_ai/services/onboarding_service.dart';
import 'package:fit_ai/models/app_location.dart';
import 'package:fit_ai/services/location_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('first-time user selects a scene and enters AI outfit flow', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final service = MemoryOnboardingService();

    await tester.pumpWidget(
      FitAIApp(
        onboardingService: service,
        locationService: _TestLocationService(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('manual-city-input')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('manual-city-input')), '上海');
    await tester.tap(find.byKey(const Key('confirm-manual-city')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('fitai-onboarding')), findsOneWidget);
    expect(find.text('你的 AI 个人穿搭顾问'), findsOneWidget);

    for (var index = 0; index < 3; index++) {
      await tester.tap(find.byKey(const Key('next-onboarding')));
      await tester.pumpAndSettle();
    }

    expect(find.text('先认识你，再生成第一套穿搭'), findsOneWidget);
    await tester.tap(find.byKey(const Key('onboarding-gender-女')));
    await tester.tap(find.byKey(const Key('onboarding-scene-工作')));
    await tester.tap(find.byKey(const Key('complete-onboarding')));
    await tester.pumpAndSettle();

    expect(find.text('AI 穿搭'), findsWidgets);
    final selected = tester.widget<ChoiceChip>(
      find.byKey(const Key('ai-scene-工作')),
    );
    expect(selected.selected, isTrue);
    expect((await service.load()).completed, isTrue);
    expect((await service.load()).firstScene, '工作');
    expect((await service.load()).profile?.height, 173);
    expect((await service.load()).profile?.gender, '女');
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('ai-height')))
          .controller
          ?.text,
      '173',
    );
  });
}

class _TestLocationService implements LocationService {
  AppLocation? location;

  @override
  Future<AppLocation?> load() async => location;

  @override
  Future<AppLocation> resolveCity(String city) async {
    location = AppLocation(
      country: '中国',
      city: city,
      latitude: 31.23,
      longitude: 121.47,
      source: 'manual',
      updatedAt: DateTime(2026),
    );
    return location!;
  }

  @override
  Future<void> save(AppLocation value) async => location = value;

  @override
  Future<AppLocation> useDeviceLocation() => resolveCity('上海');
}
