class AppLocation {
  const AppLocation({
    required this.country,
    required this.city,
    required this.latitude,
    required this.longitude,
    required this.source,
    required this.updatedAt,
  });

  final String country;
  final String city;
  final double latitude;
  final double longitude;
  final String source;
  final DateTime updatedAt;

  String get label => country.isEmpty ? city : '$country · $city';

  Map<String, dynamic> toJson() => {
        'country': country,
        'city': city,
        'latitude': latitude,
        'longitude': longitude,
        'source': source,
        'updatedAt': updatedAt.toIso8601String(),
      };

  factory AppLocation.fromJson(Map<String, dynamic> json) => AppLocation(
        country: json['country']?.toString() ?? '',
        city: json['city']?.toString() ?? '',
        latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
        longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
        source: json['source']?.toString() ?? 'manual',
        updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? '') ??
            DateTime.now(),
      );
}
