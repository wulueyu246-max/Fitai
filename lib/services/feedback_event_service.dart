import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/feedback_event.dart';
import 'analytics_service.dart';

class FeedbackEventService {
  FeedbackEventService({
    SharedPreferencesAsync? storage,
    AnalyticsService? analyticsService,
  })  : _storage = storage,
        _analyticsService = analyticsService ?? LocalAnalyticsService.instance;

  static final FeedbackEventService instance = FeedbackEventService();
  static const _key = 'fitai.feedback_history.v2';
  static const _legacyKey = 'fitai.feedback_events.v1';
  static const _limit = 300;

  SharedPreferencesAsync? _storage;
  final AnalyticsService _analyticsService;
  final List<FeedbackEvent> _events = [];
  Future<void>? _loadFuture;

  Future<List<FeedbackEvent>> load() async {
    await (_loadFuture ??= _load());
    return List.unmodifiable(_events);
  }

  Future<List<FeedbackEvent>> getFeedbackHistory() => load();

  Future<FeedbackEvent> record({
    required String userId,
    required String outfitPlanId,
    required String scene,
    required int satisfaction,
    bool? likedOutfit,
    FeedbackRating? rating,
    required bool willingToBuy,
    String? noPurchaseReason,
  }) async {
    if (satisfaction < 1 || satisfaction > 5) {
      throw ArgumentError.value(satisfaction, 'satisfaction', '满意度必须为1-5');
    }
    if (!willingToBuy &&
        (noPurchaseReason == null || noPurchaseReason.trim().isEmpty)) {
      throw ArgumentError('不愿购买时必须提供原因');
    }
    if (rating == null && likedOutfit == null) {
      throw ArgumentError('必须提供搭配评价');
    }
    final resolvedRating =
        rating ?? (likedOutfit! ? FeedbackRating.like : FeedbackRating.dislike);
    await load();
    final now = DateTime.now();
    final event = FeedbackEvent(
      id: 'feedback-event-${now.microsecondsSinceEpoch}',
      userId: userId,
      outfitPlanId: outfitPlanId,
      scene: scene,
      satisfaction: satisfaction,
      likedOutfit: resolvedRating == FeedbackRating.like,
      rating: resolvedRating,
      willingToBuy: willingToBuy,
      noPurchaseReason: willingToBuy ? null : noPurchaseReason?.trim(),
      createdAt: now,
    );
    _events.insert(0, event);
    if (_events.length > _limit) {
      _events.removeRange(_limit, _events.length);
    }
    await Future.wait([
      _save(),
      _analyticsService.track(
        'recommendation_feedback_submitted',
        userId: userId,
        properties: {
          'outfitPlanId': outfitPlanId,
          'scene': scene,
          'satisfaction': satisfaction.toString(),
          'likedOutfit': (resolvedRating == FeedbackRating.like).toString(),
          'rating': resolvedRating.name,
          'willingToBuy': willingToBuy.toString(),
          if (!willingToBuy) 'noPurchaseReason': noPurchaseReason?.trim() ?? '',
        },
      ),
    ]);
    return event;
  }

  Future<FeedbackDailySummary> getDailySummary({DateTime? day}) async {
    await load();
    final target = day ?? DateTime.now();
    final events = _events.where((event) {
      final createdAt = event.createdAt;
      return createdAt.year == target.year &&
          createdAt.month == target.month &&
          createdAt.day == target.day;
    }).toList();
    if (events.isEmpty) {
      return const FeedbackDailySummary(
        total: 0,
        averageSatisfaction: 0,
        likedRate: 0,
        purchaseIntentRate: 0,
        noPurchaseReasons: {},
      );
    }
    final reasons = <String, int>{};
    for (final event in events) {
      if (event.noPurchaseReason case final reason?) {
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
    }
    return FeedbackDailySummary(
      total: events.length,
      averageSatisfaction: events
              .map((event) => event.satisfaction)
              .reduce((left, right) => left + right) /
          events.length,
      likedRate:
          events.where((event) => event.likedOutfit).length / events.length,
      purchaseIntentRate:
          events.where((event) => event.willingToBuy).length / events.length,
      noPurchaseReasons: Map.unmodifiable(reasons),
    );
  }

  Future<void> _load() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final values = await storage.getStringList(_key) ??
          await storage.getStringList(_legacyKey) ??
          const [];
      _events
        ..clear()
        ..addAll(
          values.map(
            (value) => FeedbackEvent.fromJson(
              jsonDecode(value) as Map<String, dynamic>,
            ),
          ),
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
      // User feedback remains available in memory when storage is unavailable.
    }
  }
}
