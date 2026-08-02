import 'package:shared_preferences/shared_preferences.dart';

import '../models/fashion_feed.dart';

class OutfitChallengeService {
  OutfitChallengeService({SharedPreferencesAsync? storage})
      : _storage = storage;

  static const _key = 'fitai.challenge.7_day.check_ins';
  SharedPreferencesAsync? _storage;

  Future<OutfitChallenge> load() async {
    final checkedDates = await _readDates();
    final today = _dateKey(DateTime.now());
    return OutfitChallenge(
      id: 'seven-day-look',
      title: '7天AI穿搭挑战',
      description: '每天生成一个新 Look，让 AI 更快理解你的真实偏好。',
      totalDays: 7,
      completedDays: checkedDates.length.clamp(0, 7),
      checkedInToday: checkedDates.contains(today),
    );
  }

  Future<OutfitChallenge> checkInToday() async {
    final dates = await _readDates();
    final today = _dateKey(DateTime.now());
    final updated = [today, ...dates.where((date) => date != today)].take(7);
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setStringList(_key, updated.toList(growable: false));
    } catch (_) {
      // Challenge remains usable in-memory when local storage is unavailable.
    }
    return OutfitChallenge(
      id: 'seven-day-look',
      title: '7天AI穿搭挑战',
      description: '每天生成一个新 Look，让 AI 更快理解你的真实偏好。',
      totalDays: 7,
      completedDays: updated.length,
      checkedInToday: true,
    );
  }

  Future<List<String>> _readDates() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      return await storage.getStringList(_key) ?? const [];
    } catch (_) {
      return const [];
    }
  }

  String _dateKey(DateTime date) {
    return '${date.year.toString().padLeft(4, '0')}-'
        '${date.month.toString().padLeft(2, '0')}-'
        '${date.day.toString().padLeft(2, '0')}';
  }
}
