import 'dart:convert';

import 'package:fit_ai/models/admin_analytics_snapshot.dart';
import 'package:fit_ai/pages/account_page.dart';
import 'package:fit_ai/pages/admin_analytics_page.dart';
import 'package:fit_ai/services/admin_analytics_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('admin analytics loads aggregated server metrics and commission',
      () async {
    late http.Request capturedRequest;
    final service = AdminAnalyticsService(
      remoteEndpoint: Uri.parse('https://api.fitai.test/admin/analytics'),
      adminKey: 'internal-test-key',
      client: MockClient((request) async {
        capturedRequest = request;
        return http.Response(
          jsonEncode({
            'userCount': 28,
            'activeUsers': 11,
            'newUsers': 4,
            'photoUploadUsers': 7,
            'outfitGenerationCount': 12,
            'productImpressions': 100,
            'productClicks': 20,
            'productDetailViews': 16,
            'purchaseIntents': 8,
            'productFavorites': 9,
            'purchaseRedirects': 5,
            'feedbackCount': 6,
            'potentialCommission': 119.8,
            'confirmedCommission': 39.9,
            'averageSatisfaction': 4.2,
            'purchaseIntentRate': 0.5,
            'noPurchaseReasons': {'价格太高': 2},
            'totalProductImpressions': 300,
            'totalProductClicks': 60,
            'totalProductFavorites': 22,
            'totalTryOns': 18,
            'totalPurchaseRedirects': 12,
            'totalPurchaseCompleted': 3,
            'generatedAt': '2026-07-31T10:00:00.000Z',
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    final snapshot = await service.load();

    expect(capturedRequest.headers['x-admin-key'], 'internal-test-key');
    expect(snapshot.dataScope, '服务端全部测试用户');
    expect(snapshot.dailyProductClicks, 20);
    expect(snapshot.clickThroughRate, 0.2);
    expect(snapshot.potentialCommission, 119.8);
    expect(snapshot.confirmedCommission, 39.9);
    expect(snapshot.purchaseCompletedCount, 3);
  });

  testWidgets('commercial panel shows core validation and revenue metrics',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: AdminAnalyticsPage(
          service: _SnapshotAnalyticsService(_snapshot),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('今日用户验证数据'), findsOneWidget);
    expect(find.textContaining('服务端全部测试用户'), findsOneWidget);
    expect(find.text('预计佣金'), findsOneWidget);
    expect(find.text('¥119.80'), findsOneWidget);
    expect(find.text('确认佣金'), findsOneWidget);
    expect(find.text('¥39.90'), findsOneWidget);
  });

  testWidgets('public account page hides internal revenue and analytics tools',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
          home: Scaffold(body: AccountPage(showInternalTools: false))),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('open-affiliate-revenue')), findsNothing);
    expect(find.byKey(const Key('open-admin-analytics')), findsNothing);
    expect(find.byKey(const Key('open-brand-partner-center')), findsNothing);
  });
}

final _snapshot = AdminAnalyticsSnapshot(
  totalUsers: 28,
  activeUsers: 11,
  productImpressions: 300,
  productClicks: 60,
  favoriteCount: 22,
  tryOnCount: 18,
  purchaseRedirectCount: 12,
  purchaseCompletedCount: 3,
  dailyNewUsers: 4,
  dailyPhotoUploadUsers: 7,
  dailyOutfitGenerationCount: 12,
  dailyProductImpressions: 100,
  dailyProductClicks: 20,
  dailyProductDetailViews: 16,
  dailyPurchaseIntentCount: 8,
  dailyFavoriteCount: 9,
  dailyPurchaseRedirectCount: 5,
  dailyFeedbackCount: 6,
  potentialCommission: 119.8,
  confirmedCommission: 39.9,
  averageSatisfaction: 4.2,
  purchaseIntentRate: 0.5,
  noPurchaseReasons: const {'价格太高': 2},
  dataScope: '服务端全部测试用户',
  generatedAt: DateTime(2026, 7, 31),
);

class _SnapshotAnalyticsService extends AdminAnalyticsService {
  _SnapshotAnalyticsService(this.snapshot);

  final AdminAnalyticsSnapshot snapshot;

  @override
  Future<AdminAnalyticsSnapshot> load() async => snapshot;
}
