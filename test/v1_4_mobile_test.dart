import 'package:fit_ai/features/user/repositories/local_auth_repository.dart';
import 'package:fit_ai/models/app_location.dart';
import 'package:fit_ai/services/weather_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('weather response exposes all AI recommendation inputs', () async {
    final service = WeatherService(
      client: MockClient((request) async {
        expect(request.url.host, 'api.open-meteo.com');
        expect(request.url.queryParameters['timezone'], 'auto');
        return http.Response(
          '{"current":{"temperature_2m":25.4,"weather_code":2,'
          '"relative_humidity_2m":78,"wind_speed_10m":11.5},'
          '"daily":{"temperature_2m_max":[29.2],'
          '"temperature_2m_min":[19.8]}}',
          200,
        );
      }),
    );
    final result = await service.fetch(
      AppLocation(
        country: '中国',
        city: '上海',
        latitude: 31.23,
        longitude: 121.47,
        source: 'manual',
        updatedAt: DateTime(2026),
      ),
    );

    expect(result.city, '上海');
    expect(result.condition, '多云');
    expect(result.high, 29.2);
    expect(result.low, 19.8);
    expect(result.humidity, 78);
    expect(result.windSpeed, 11.5);
    expect(result.aiContext, contains('湿度78%'));
    expect(result.aiContext, contains('风速11.5km/h'));
  });

  test('local phone verification creates an authenticated session', () async {
    final repository = LocalAuthRepository();
    final challenge = await repository.requestPhoneCode('+8613812345678');
    final result = await repository.loginWithPhoneCode(
      phone: '+8613812345678',
      code: challenge.debugCode!,
    );

    expect(result.account.phone, '+8613812345678');
    expect(result.session.isExpired, isFalse);
  });
}
