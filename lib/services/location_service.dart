import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_location.dart';

abstract interface class LocationService {
  Future<AppLocation?> load();
  Future<AppLocation> useDeviceLocation();
  Future<AppLocation> resolveCity(String city);
  Future<void> save(AppLocation location);
}

class DeviceLocationService implements LocationService {
  DeviceLocationService({http.Client? client, SharedPreferencesAsync? storage})
      : _client = client ?? http.Client(),
        _storage = storage;

  static const _storageKey = 'shupi.location.v1';
  final http.Client _client;
  SharedPreferencesAsync? _storage;

  @override
  Future<AppLocation?> load() async {
    try {
      final value =
          await (_storage ??= SharedPreferencesAsync()).getString(_storageKey);
      if (value == null) return null;
      return AppLocation.fromJson(jsonDecode(value) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<AppLocation> useDeviceLocation() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationException('请先开启手机定位服务');
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw const LocationException('定位权限未开启，请手动选择城市');
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.medium,
        timeLimit: Duration(seconds: 12),
      ),
    );
    var country = '';
    var city = '当前位置';
    if (!kIsWeb) {
      try {
        final places = await Geocoding(
          locale: const Locale('zh', 'CN'),
        ).placemarkFromCoordinates(position.latitude, position.longitude);
        if (places.isNotEmpty) {
          final place = places.first;
          country = place.country ?? '';
          city = place.locality?.trim().isNotEmpty == true
              ? place.locality!.trim()
              : (place.administrativeArea?.trim().isNotEmpty == true
                  ? place.administrativeArea!.trim()
                  : city);
        }
      } catch (_) {
        // Coordinates still allow accurate weather when reverse geocoding fails.
      }
    }
    final location = AppLocation(
      country: country,
      city: city,
      latitude: position.latitude,
      longitude: position.longitude,
      source: 'device',
      updatedAt: DateTime.now(),
    );
    await save(location);
    return location;
  }

  @override
  Future<AppLocation> resolveCity(String city) async {
    final query = city.trim();
    if (query.isEmpty) throw const LocationException('请输入城市名称');
    final uri = Uri.https('geocoding-api.open-meteo.com', '/v1/search', {
      'name': query,
      'count': '1',
      'language': 'zh',
      'format': 'json',
    });
    try {
      final response =
          await _client.get(uri).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) {
        throw const LocationException('城市查询失败，请稍后再试');
      }
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final results = body['results'] as List<dynamic>?;
      if (results == null || results.isEmpty) {
        throw const LocationException('没有找到该城市，请检查名称');
      }
      final result = results.first as Map<String, dynamic>;
      final location = AppLocation(
        country: result['country']?.toString() ?? '',
        city: result['name']?.toString() ?? query,
        latitude: (result['latitude'] as num).toDouble(),
        longitude: (result['longitude'] as num).toDouble(),
        source: 'manual',
        updatedAt: DateTime.now(),
      );
      await save(location);
      return location;
    } on LocationException {
      rethrow;
    } catch (_) {
      throw const LocationException('网络不可用，请联网后重试');
    }
  }

  @override
  Future<void> save(AppLocation location) async {
    await (_storage ??= SharedPreferencesAsync())
        .setString(_storageKey, jsonEncode(location.toJson()));
  }
}

class LocationException implements Exception {
  const LocationException(this.message);
  final String message;
  @override
  String toString() => message;
}
