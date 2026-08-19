import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config/app_config.dart';
import '../models/analytics_event.dart';

abstract interface class AnalyticsService {
  Future<void> track(
    String name, {
    String userId,
    Map<String, String> properties,
  });

  Future<void> trackSession({String userId});

  Future<void> trackPageDwell(
    String page,
    Duration duration, {
    String userId,
  });

  Future<AnalyticsDashboard> getDashboard();
}

class LocalAnalyticsService implements AnalyticsService {
  LocalAnalyticsService({
    SharedPreferencesAsync? storage,
    http.Client? client,
    Uri? remoteEndpoint,
  })  : _storage = storage,
        _client = client ?? http.Client(),
        _remoteEndpoint = remoteEndpoint;

  static final LocalAnalyticsService instance = LocalAnalyticsService(
    remoteEndpoint: _environmentEndpoint(),
  );
  static const _key = 'fitai.analytics.events.v1';
  static const _installationIdKey = 'fitai.analytics.installation_id.v1';
  static const _limit = 1000;

  SharedPreferencesAsync? _storage;
  final http.Client _client;
  final Uri? _remoteEndpoint;
  final List<AnalyticsEvent> _events = [];
  Future<void>? _loadFuture;
  String? _installationIdMemory;

  static Uri? _environmentEndpoint() {
    const analyticsBaseUrl = String.fromEnvironment('ANALYTICS_API_BASE_URL');
    const apiBaseUrl = String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: AppConfig.defaultApiBaseUrl,
    );
    final baseUrl = analyticsBaseUrl.isNotEmpty ? analyticsBaseUrl : apiBaseUrl;
    final normalized = baseUrl.replaceFirst(RegExp(r'/$'), '');
    final uri = Uri.tryParse('$normalized/analytics/events');
    return baseUrl.isNotEmpty &&
            uri != null &&
            uri.hasScheme &&
            uri.host.isNotEmpty
        ? uri
        : null;
  }

  Future<void> _ensureLoaded() => _loadFuture ??= _load();

  @override
  Future<void> track(
    String name, {
    String userId = 'local-demo-user',
    Map<String, String> properties = const {},
  }) async {
    await _ensureLoaded();
    final now = DateTime.now();
    final resolvedUserId =
        userId == 'local-demo-user' ? await _installationId() : userId;
    final event = AnalyticsEvent(
      id: 'analytics-${now.microsecondsSinceEpoch}',
      name: name,
      userId: resolvedUserId,
      createdAt: now,
      properties: properties,
    );
    _events.insert(
      0,
      event,
    );
    if (_events.length > _limit) {
      _events.removeRange(_limit, _events.length);
    }
    await _save();
    if (_remoteEndpoint != null) {
      unawaited(_sendRemote(event));
    }
  }

  @override
  Future<void> trackSession({String userId = 'local-demo-user'}) async {
    await _ensureLoaded();
    final now = DateTime.now();
    final resolvedUserId =
        userId == 'local-demo-user' ? await _installationId() : userId;
    final alreadyTracked = _events.any(
      (event) =>
          event.name == 'app_session' &&
          event.userId == resolvedUserId &&
          _isSameDay(event.createdAt, now),
    );
    if (!alreadyTracked) {
      await track('app_session', userId: resolvedUserId);
    }
  }

  @override
  Future<void> trackPageDwell(
    String page,
    Duration duration, {
    String userId = 'local-demo-user',
  }) {
    return track(
      'page_dwell',
      userId: userId,
      properties: {
        'page': page,
        'durationMs': duration.inMilliseconds.toString(),
      },
    );
  }

  @override
  Future<AnalyticsDashboard> getDashboard() async {
    await _ensureLoaded();
    final today = DateTime.now();
    final todayEvents =
        _events.where((event) => _isSameDay(event.createdAt, today)).toList();
    final users = todayEvents.map((event) => event.userId).toSet();
    int todayCount(String name) =>
        todayEvents.where((event) => event.name == name).length;
    int todayUniqueUsers(Iterable<String> names) {
      final accepted = names.toSet();
      return todayEvents
          .where((event) => accepted.contains(event.name))
          .map((event) => event.userId)
          .toSet()
          .length;
    }

    final impressions =
        _events.where((event) => event.name == 'product_impression').length;
    final clicks =
        _events.where((event) => event.name == 'product_click').length;
    final purchases = _events
        .where((event) => event.name == 'product_purchase_completed')
        .length;
    final tryOns =
        _events.where((event) => event.name == 'product_try_on').length;
    final dwellEvents =
        _events.where((event) => event.name == 'page_dwell').toList();
    final totalDwellMs = dwellEvents.fold<int>(
      0,
      (total, event) =>
          total + (int.tryParse(event.properties['durationMs'] ?? '') ?? 0),
    );
    final popularity = <String, int>{};
    for (final event in _events) {
      final productId = event.properties['productId'];
      if (productId == null || event.name == 'product_impression') {
        continue;
      }
      popularity[productId] = (popularity[productId] ?? 0) + 1;
    }
    final popularProductIds = popularity.entries.toList()
      ..sort((left, right) {
        final comparison = right.value.compareTo(left.value);
        return comparison != 0 ? comparison : left.key.compareTo(right.key);
      });

    return AnalyticsDashboard(
      dailyActiveUsers: users.length,
      recommendationClickRate: impressions == 0 ? 0 : clicks / impressions,
      productConversionRate: clicks == 0 ? 0 : purchases / clicks,
      tryOnCount: tryOns,
      tryOnRate: clicks == 0 ? 0 : tryOns / clicks,
      averageDwellSeconds:
          dwellEvents.isEmpty ? 0 : totalDwellMs / dwellEvents.length / 1000,
      popularProductIds: List.unmodifiable(
        popularProductIds.take(10).map((entry) => entry.key),
      ),
      dailyNewUsers: todayUniqueUsers([
        'new_user_onboarding_completed',
        'user_registered',
      ]),
      dailyPhotoUploadUsers: todayUniqueUsers(['photo_upload_completed']),
      dailyOutfitGenerationCount: todayCount('outfit_generated'),
      dailyProductImpressions: todayCount('product_impression'),
      dailyProductClicks: todayCount('product_click'),
      dailyProductDetailViews: todayCount('product_detail_view'),
      dailyPurchaseIntents: todayCount('purchase_intent'),
      dailyFavorites: todayCount('product_favorite'),
      dailyPurchaseRedirects: todayCount('product_purchase_redirect'),
    );
  }

  Future<void> _load() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final values = await storage.getStringList(_key) ?? const [];
      _events
        ..clear()
        ..addAll(
          values.map((value) {
            final json = jsonDecode(value);
            return AnalyticsEvent.fromJson(json as Map<String, dynamic>);
          }),
        );
    } catch (_) {
      _events.clear();
    }
  }

  Future<void> _save() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setStringList(
        _key,
        _events.map((event) => jsonEncode(event.toJson())).toList(),
      );
    } catch (_) {
      // Analytics never blocks the user-facing flow.
    }
  }

  Future<String> _installationId() async {
    if (_installationIdMemory case final value?) {
      return value;
    }
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final stored = await storage.getString(_installationIdKey);
      if (stored != null && stored.isNotEmpty) {
        return _installationIdMemory = stored;
      }
      final random = Random.secure();
      final generated = 'install-${DateTime.now().microsecondsSinceEpoch}-'
          '${random.nextInt(1 << 32).toRadixString(16)}';
      await storage.setString(_installationIdKey, generated);
      return _installationIdMemory = generated;
    } catch (_) {
      return _installationIdMemory =
          'session-${DateTime.now().microsecondsSinceEpoch}';
    }
  }

  Future<void> _sendRemote(AnalyticsEvent event) async {
    try {
      await _client
          .post(
            _remoteEndpoint!,
            headers: const {'content-type': 'application/json'},
            body: jsonEncode(event.toJson()),
          )
          .timeout(AppConfig.backendTimeout);
    } catch (_) {
      // Remote analytics is best-effort and never blocks the product flow.
    }
  }

  bool _isSameDay(DateTime left, DateTime right) {
    return left.year == right.year &&
        left.month == right.month &&
        left.day == right.day;
  }
}
