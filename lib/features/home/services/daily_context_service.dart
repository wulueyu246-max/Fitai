import '../models/daily_fashion_context.dart';
import '../../../services/location_service.dart';
import '../../../services/weather_service.dart';

abstract interface class DailyContextService {
  Future<DailyFashionContext> getTodayContext();
}

/// 测试和离线预览使用的稳定天气上下文。
class MockDailyContextService implements DailyContextService {
  const MockDailyContextService({
    this.temperature = 25,
    this.condition = '多云',
    this.city = '本地',
    this.delay = const Duration(milliseconds: 120),
  });

  final int temperature;
  final String condition;
  final String city;
  final Duration delay;

  @override
  Future<DailyFashionContext> getTodayContext() async {
    if (delay != Duration.zero) {
      await Future<void>.delayed(delay);
    }
    return DailyFashionContext(
      temperature: temperature,
      condition: condition,
      city: city,
      updatedAt: DateTime.now(),
    );
  }
}

class LiveDailyContextService implements DailyContextService {
  LiveDailyContextService({
    LocationService? locationService,
    WeatherService? weatherService,
  })  : _locationService = locationService ?? DeviceLocationService(),
        _weatherService = weatherService ?? WeatherService();

  final LocationService _locationService;
  final WeatherService _weatherService;

  @override
  Future<DailyFashionContext> getTodayContext() async {
    final location = await _locationService.load();
    if (location == null) {
      return const MockDailyContextService().getTodayContext();
    }
    final weather = await _weatherService.fetch(location);
    return DailyFashionContext(
      temperature: weather.temperature.round(),
      condition: weather.condition,
      city: weather.city,
      country: weather.country,
      humidity: weather.humidity,
      windSpeed: weather.windSpeed,
      high: weather.high.round(),
      low: weather.low.round(),
      updatedAt: weather.updatedAt,
    );
  }
}
