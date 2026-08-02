class DailyFashionContext {
  const DailyFashionContext({
    required this.temperature,
    required this.condition,
    required this.city,
    required this.updatedAt,
    this.country = '',
    this.humidity = 0,
    this.windSpeed = 0,
    this.high,
    this.low,
  });

  final int temperature;
  final String condition;
  final String city;
  final DateTime updatedAt;
  final String country;
  final double humidity;
  final double windSpeed;
  final int? high;
  final int? low;

  String get temperatureLabel => '$temperature℃';
  String get detailLabel {
    final range = high == null || low == null ? '' : ' · $low°/$high°';
    return '$condition$range · 湿度 ${humidity.round()}% · '
        '风力 ${windSpeed.toStringAsFixed(1)} km/h';
  }

  String get aiContext => '$city $temperatureLabel，$detailLabel';
}
