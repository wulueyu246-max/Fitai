import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../features/user/services/user_session_controller.dart';
import '../models/admin_analytics_snapshot.dart';
import '../models/affiliate_revenue_summary.dart';
import '../models/analytics_event.dart';
import '../models/feedback_event.dart';
import '../models/product_analytics.dart';
import 'affiliate_revenue_service.dart';
import 'analytics_service.dart';
import 'feedback_event_service.dart';
import 'product_analytics_service.dart';

class AdminAnalyticsService {
  AdminAnalyticsService({
    AnalyticsService? analyticsService,
    ProductAnalyticsService? productAnalyticsService,
    UserSessionController? sessionController,
    FeedbackEventService? feedbackEventService,
    AffiliateRevenueService? revenueService,
    http.Client? client,
    Uri? remoteEndpoint,
    String? adminKey,
  })  : _analyticsService = analyticsService ?? LocalAnalyticsService.instance,
        _productAnalyticsService =
            productAnalyticsService ?? ProductAnalyticsService.instance,
        _sessionController =
            sessionController ?? UserSessionController.instance,
        _feedbackEventService =
            feedbackEventService ?? FeedbackEventService.instance,
        _revenueService = revenueService ??
            AffiliateRevenueService(
              analytics:
                  productAnalyticsService ?? ProductAnalyticsService.instance,
            ),
        _client = client ?? http.Client(),
        _remoteEndpoint = remoteEndpoint ?? _environmentEndpoint(),
        _adminKey = adminKey ?? _environmentAdminKey();

  final AnalyticsService _analyticsService;
  final ProductAnalyticsService _productAnalyticsService;
  final UserSessionController _sessionController;
  final FeedbackEventService _feedbackEventService;
  final AffiliateRevenueService _revenueService;
  final http.Client _client;
  final Uri? _remoteEndpoint;
  final String _adminKey;

  static Uri? _environmentEndpoint() {
    const configuredBaseUrl =
        String.fromEnvironment('ANALYTICS_API_BASE_URL');
    const apiBaseUrl = String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: AppConfig.defaultApiBaseUrl,
    );
    final baseUrl =
        configuredBaseUrl.isEmpty ? apiBaseUrl : configuredBaseUrl;
    final normalized = baseUrl.replaceFirst(RegExp(r'/$'), '');
    final uri = Uri.tryParse('$normalized/admin/analytics');
    return baseUrl.isNotEmpty &&
            uri != null &&
            uri.hasScheme &&
            uri.host.isNotEmpty
        ? uri
        : null;
  }

  static String _environmentAdminKey() {
    return const String.fromEnvironment('ADMIN_ANALYTICS_KEY').trim();
  }

  Future<AdminAnalyticsSnapshot> load() {
    if (_remoteEndpoint != null && _adminKey.isNotEmpty) {
      return _loadRemote();
    }
    return _loadLocal();
  }

  Future<AdminAnalyticsSnapshot> _loadLocal() async {
    await _sessionController.ensureLoaded();
    final results = await Future.wait([
      _analyticsService.getDashboard(),
      _productAnalyticsService.getFunnel(),
      _feedbackEventService.getDailySummary(),
      _revenueService.load(),
    ]);
    final dashboard = results[0] as AnalyticsDashboard;
    final funnel = results[1] as ProductConversionFunnel;
    final feedback = results[2] as FeedbackDailySummary;
    final revenue = results[3] as AffiliateRevenueSummary;
    return AdminAnalyticsSnapshot(
      totalUsers: _sessionController.account == null ? 0 : 1,
      activeUsers: dashboard.dailyActiveUsers,
      productImpressions: funnel.impressions,
      productClicks: funnel.clicks,
      favoriteCount: funnel.favorites,
      tryOnCount: funnel.tryOns,
      purchaseRedirectCount: funnel.purchaseRedirects,
      purchaseCompletedCount: funnel.purchasesCompleted,
      dailyNewUsers: dashboard.dailyNewUsers,
      dailyPhotoUploadUsers: dashboard.dailyPhotoUploadUsers,
      dailyOutfitGenerationCount: dashboard.dailyOutfitGenerationCount,
      dailyProductImpressions: dashboard.dailyProductImpressions,
      dailyProductClicks: dashboard.dailyProductClicks,
      dailyProductDetailViews: dashboard.dailyProductDetailViews,
      dailyPurchaseIntentCount: dashboard.dailyPurchaseIntents,
      dailyFavoriteCount: dashboard.dailyFavorites,
      dailyPurchaseRedirectCount: dashboard.dailyPurchaseRedirects,
      dailyFeedbackCount: feedback.total,
      potentialCommission: revenue.potentialCommission,
      confirmedCommission: revenue.confirmedCommission,
      averageSatisfaction: feedback.averageSatisfaction,
      purchaseIntentRate: feedback.purchaseIntentRate,
      noPurchaseReasons: feedback.noPurchaseReasons,
      dataScope: '本设备测试数据',
      generatedAt: DateTime.now(),
    );
  }

  Future<AdminAnalyticsSnapshot> _loadRemote() async {
    final response = await _client.get(
      _remoteEndpoint!,
      headers: {'x-admin-key': _adminKey},
    ).timeout(AppConfig.backendTimeout);
    if (response.statusCode != 200) {
      throw StateError('运营数据服务返回 ${response.statusCode}');
    }
    final value = jsonDecode(response.body);
    if (value is! Map<String, dynamic>) {
      throw const FormatException('运营数据格式无效');
    }
    return AdminAnalyticsSnapshot(
      totalUsers: _int(value, 'userCount'),
      activeUsers: _int(value, 'activeUsers'),
      productImpressions: _int(value, 'totalProductImpressions'),
      productClicks: _int(value, 'totalProductClicks'),
      favoriteCount: _int(value, 'totalProductFavorites'),
      tryOnCount: _int(value, 'totalTryOns'),
      purchaseRedirectCount: _int(value, 'totalPurchaseRedirects'),
      purchaseCompletedCount: _int(value, 'totalPurchaseCompleted'),
      dailyNewUsers: _int(value, 'newUsers'),
      dailyPhotoUploadUsers: _int(value, 'photoUploadUsers'),
      dailyOutfitGenerationCount: _int(value, 'outfitGenerationCount'),
      dailyProductImpressions: _int(value, 'productImpressions'),
      dailyProductClicks: _int(value, 'productClicks'),
      dailyProductDetailViews: _int(value, 'productDetailViews'),
      dailyPurchaseIntentCount: _int(value, 'purchaseIntents'),
      dailyFavoriteCount: _int(value, 'productFavorites'),
      dailyPurchaseRedirectCount: _int(value, 'purchaseRedirects'),
      dailyFeedbackCount: _int(value, 'feedbackCount'),
      potentialCommission: _double(value, 'potentialCommission'),
      confirmedCommission: _double(value, 'confirmedCommission'),
      averageSatisfaction: _double(value, 'averageSatisfaction'),
      purchaseIntentRate: _double(value, 'purchaseIntentRate'),
      noPurchaseReasons: _intMap(value['noPurchaseReasons']),
      dataScope: '服务端全部测试用户',
      generatedAt: DateTime.tryParse(value['generatedAt']?.toString() ?? '') ??
          DateTime.now(),
    );
  }

  static int _int(Map<String, dynamic> value, String key) {
    return (value[key] as num?)?.toInt() ?? 0;
  }

  static double _double(Map<String, dynamic> value, String key) {
    return (value[key] as num?)?.toDouble() ?? 0;
  }

  static Map<String, int> _intMap(Object? value) {
    if (value is! Map) {
      return const {};
    }
    return Map.unmodifiable({
      for (final entry in value.entries)
        entry.key.toString(): (entry.value as num?)?.toInt() ?? 0,
    });
  }
}
