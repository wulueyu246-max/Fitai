import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/recommendation_feedback.dart';

class RecommendationFeedbackService {
  RecommendationFeedbackService({SharedPreferencesAsync? storage})
      : _storage = storage;

  static final RecommendationFeedbackService instance =
      RecommendationFeedbackService();
  static const _key = 'fitai.recommendation_feedback.v1';
  static const _historyLimit = 200;

  SharedPreferencesAsync? _storage;
  final List<RecommendationFeedback> _records = [];
  Future<List<RecommendationFeedback>>? _loadFuture;

  List<RecommendationFeedback> get records =>
      List<RecommendationFeedback>.unmodifiable(_records);

  Future<List<RecommendationFeedback>> load() {
    return _loadFuture ??= _load();
  }

  Future<RecommendationFeedback> record({
    required RecommendationFeedbackAction action,
    String userId = 'local-demo-user',
    String? productId,
    String? outfitPlanId,
    String source = 'unknown',
  }) async {
    await load();
    final now = DateTime.now();
    final feedback = RecommendationFeedback(
      id: 'feedback-${now.microsecondsSinceEpoch}',
      userId: userId,
      action: action,
      productId: productId,
      outfitPlanId: outfitPlanId,
      source: source,
      createdAt: now,
    );
    _records.insert(0, feedback);
    if (_records.length > _historyLimit) {
      _records.removeRange(_historyLimit, _records.length);
    }
    await _save();
    return feedback;
  }

  Future<List<RecommendationFeedback>> _load() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final values = await storage.getStringList(_key) ?? const [];
      _records
        ..clear()
        ..addAll(
          values.map((value) {
            final json = jsonDecode(value);
            return RecommendationFeedback.fromJson(
              json as Map<String, dynamic>,
            );
          }),
        );
    } catch (_) {
      _records.clear();
    }
    return records;
  }

  Future<void> _save() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setStringList(
        _key,
        _records.map((item) => jsonEncode(item.toJson())).toList(),
      );
    } catch (_) {
      // Feedback stays available in memory if platform storage is unavailable.
    }
  }
}
