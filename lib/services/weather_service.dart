import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_location.dart';
import '../models/weather_snapshot.dart';

class WeatherService {
  WeatherService({http.Client? client, SharedPreferencesAsync? storage})
      : _client = client ?? http.Client(),
        _storage = storage;

  static const _cacheKey = 'shupi.weather.v1';
  final http.Client _client;
  SharedPreferencesAsync? _storage;

  Future<WeatherSnapshot> fetch(AppLocation location) async {
    final uri = Uri.https('api.open-meteo.com', '/v1/forecast', {
      'latitude': location.latitude.toString(),
      'longitude': location.longitude.toString(),
      'current':
          'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
      'daily': 'temperature_2m_max,temperature_2m_min',
      'timezone': 'auto',
      'forecast_days': '1',
    });
    try {
      final response =
          await _client.get(uri).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) throw const WeatherException('天气服务暂时不可用');
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final current = body['current'] as Map<String, dynamic>? ?? const {};
      final daily = body['daily'] as Map<String, dynamic>? ?? const {};
      final code = (current['weather_code'] as num?)?.toInt() ?? -1;
      final snapshot = WeatherSnapshot(
        city: location.city,
        country: location.country,
        temperature: (current['temperature_2m'] as num?)?.toDouble() ?? 0,
        condition: conditionFor(code),
        humidity: (current['relative_humidity_2m'] as num?)?.toDouble() ?? 0,
        windSpeed: (current['wind_speed_10m'] as num?)?.toDouble() ?? 0,
        high: _firstNumber(daily['temperature_2m_max']),
        low: _firstNumber(daily['temperature_2m_min']),
        weatherCode: code,
        updatedAt: DateTime.now(),
      );
      // 天气结果本身可用时，不应因为本地缓存写入失败而阻断推荐流程。
      try {
        await (_storage ??= SharedPreferencesAsync())
            .setString(_cacheKey, jsonEncode(snapshot.toJson()));
      } catch (_) {
        // Cache persistence is best-effort. The live response still wins.
      }
      return snapshot;
    } catch (error) {
      final cached = await loadCached();
      if (cached != null) return cached;
      if (error is WeatherException) rethrow;
      throw const WeatherException('无法获取天气，请检查网络连接');
    }
  }

  Future<WeatherSnapshot?> loadCached() async {
    try {
      final value =
          await (_storage ??= SharedPreferencesAsync()).getString(_cacheKey);
      return value == null
          ? null
          : WeatherSnapshot.fromJson(jsonDecode(value) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  static double _firstNumber(dynamic value) {
    if (value is List && value.isNotEmpty && value.first is num) {
      return (value.first as num).toDouble();
    }
    return 0;
  }

  static String conditionFor(int code) {
    if (code == 0) return '晴朗';
    if (code <= 3) return '多云';
    if (code == 45 || code == 48) return '雾';
    if (code >= 51 && code <= 67) return '有雨';
    if (code >= 71 && code <= 77) return '有雪';
    if (code >= 80 && code <= 82) return '阵雨';
    if (code >= 85 && code <= 86) return '阵雪';
    if (code >= 95) return '雷雨';
    return '天气变化';
  }
}

class WeatherException implements Exception {
  const WeatherException(this.message);
  final String message;
  @override
  String toString() => message;
}
