class WeatherSnapshot {
  const WeatherSnapshot({
    required this.city,
    required this.country,
    required this.temperature,
    required this.condition,
    this.humidity = 0,
    required this.windSpeed,
    required this.high,
    required this.low,
    required this.weatherCode,
    required this.updatedAt,
  });

  final String city;
  final String country;
  final double temperature;
  final String condition;
  final double humidity;
  final double windSpeed;
  final double high;
  final double low;
  final int weatherCode;
  final DateTime updatedAt;

  String get aiContext =>
      '$city，${temperature.round()}℃，$condition，最高${high.round()}℃，'
      '最低${low.round()}℃，湿度${humidity.round()}%，'
      '风速${windSpeed.toStringAsFixed(1)}km/h';

  bool get isRainy =>
      condition.contains('雨') ||
      (weatherCode >= 51 && weatherCode <= 67) ||
      (weatherCode >= 80 && weatherCode <= 82) ||
      weatherCode >= 95;

  bool get isSnowy =>
      condition.contains('雪') ||
      (weatherCode >= 71 && weatherCode <= 77) ||
      (weatherCode >= 85 && weatherCode <= 86);

  Map<String, dynamic> toJson() => {
        'city': city,
        'country': country,
        'temperature': temperature,
        'condition': condition,
        'humidity': humidity,
        'windSpeed': windSpeed,
        'high': high,
        'low': low,
        'weatherCode': weatherCode,
        'updatedAt': updatedAt.toIso8601String(),
      };

  factory WeatherSnapshot.fromJson(Map<String, dynamic> json) =>
      WeatherSnapshot(
        city: json['city']?.toString() ?? '',
        country: json['country']?.toString() ?? '',
        temperature: (json['temperature'] as num?)?.toDouble() ?? 0,
        condition: json['condition']?.toString() ?? '未知',
        humidity: (json['humidity'] as num?)?.toDouble() ?? 0,
        windSpeed: (json['windSpeed'] as num?)?.toDouble() ?? 0,
        high: (json['high'] as num?)?.toDouble() ?? 0,
        low: (json['low'] as num?)?.toDouble() ?? 0,
        weatherCode: (json['weatherCode'] as num?)?.toInt() ?? -1,
        updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? '') ??
            DateTime.now(),
      );
}
