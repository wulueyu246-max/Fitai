import 'package:fit_ai/components/recommendation_feedback_card.dart';
import 'package:fit_ai/models/analytics_event.dart';
import 'package:fit_ai/models/feedback_event.dart';
import 'package:fit_ai/services/analytics_service.dart';
import 'package:fit_ai/services/feedback_event_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('records commercial validation feedback with non-purchase reason',
      () async {
    final analytics = _RecordingAnalyticsService();
    final service = FeedbackEventService(analyticsService: analytics);

    final event = await service.record(
      userId: 'user-1',
      outfitPlanId: 'plan-1',
      scene: '工作',
      satisfaction: 4,
      likedOutfit: true,
      willingToBuy: false,
      noPurchaseReason: '价格太高',
    );

    expect(event.satisfaction, 4);
    expect(event.noPurchaseReason, '价格太高');
    expect(analytics.names, contains('recommendation_feedback_submitted'));
    final summary = await service.getDailySummary();
    expect(summary.total, greaterThanOrEqualTo(1));
    expect(summary.noPurchaseReasons['价格太高'], greaterThanOrEqualTo(1));
  });

  test('requires a reason when the user is not willing to buy', () async {
    final service = FeedbackEventService(
      analyticsService: _RecordingAnalyticsService(),
    );

    await expectLater(
      service.record(
        userId: 'user-1',
        outfitPlanId: 'plan-1',
        scene: '工作',
        satisfaction: 3,
        likedOutfit: false,
        willingToBuy: false,
      ),
      throwsArgumentError,
    );
  });

  test('stores neutral recommendation feedback in feedback history', () async {
    final service = FeedbackEventService(
      analyticsService: _RecordingAnalyticsService(),
    );
    final event = await service.record(
      userId: 'user-neutral',
      outfitPlanId: 'plan-neutral',
      scene: '旅行',
      satisfaction: 3,
      rating: FeedbackRating.neutral,
      willingToBuy: true,
    );

    expect(event.rating, FeedbackRating.neutral);
    expect(event.likedOutfit, isFalse);
    expect(await service.getFeedbackHistory(), contains(event));
  });

  testWidgets('feedback card captures satisfaction, liking and purchase intent',
      (tester) async {
    RecommendationFeedbackInput? submitted;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: RecommendationFeedbackCard(
              onSubmit: (input) async => submitted = input,
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('feedback-score-5')));
    await tester.tap(find.byKey(const Key('feedback-like-yes')));
    await tester.tap(find.byKey(const Key('feedback-buy-no')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('feedback-reason-没有购买需求')));
    await tester.pump();
    await tester.tap(
      find.byKey(const Key('submit-recommendation-feedback')),
    );
    await tester.pumpAndSettle();

    expect(submitted?.satisfaction, 5);
    expect(submitted?.likedOutfit, isTrue);
    expect(submitted?.willingToBuy, isFalse);
    expect(submitted?.noPurchaseReason, '没有购买需求');
  });
}

class _RecordingAnalyticsService implements AnalyticsService {
  final List<String> names = [];

  @override
  Future<AnalyticsDashboard> getDashboard() {
    throw UnimplementedError();
  }

  @override
  Future<void> track(
    String name, {
    String userId = 'local-demo-user',
    Map<String, String> properties = const {},
  }) async {
    names.add(name);
  }

  @override
  Future<void> trackPageDwell(
    String page,
    Duration duration, {
    String userId = 'local-demo-user',
  }) async {}

  @override
  Future<void> trackSession({String userId = 'local-demo-user'}) async {}
}
