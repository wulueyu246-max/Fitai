class OutfitRequest {
  const OutfitRequest({
    required this.height,
    required this.weight,
    required this.scene,
    required this.request,
    required this.images,
    this.gender = 'unisex',
    this.itemBudget = '200-500',
    this.outfitBudget = '800-1500',
    this.location = const {},
    this.weather = const {},
    this.weatherConstraints = const [],
    this.bodyProfile = const {},
  });

  final double height;
  final double weight;
  final String scene;
  final String request;
  final Map<String, String> images;
  final String gender;
  final String itemBudget;
  final String outfitBudget;
  final Map<String, dynamic> location;
  final Map<String, dynamic> weather;
  final List<String> weatherConstraints;
  final Map<String, dynamic> bodyProfile;

  Map<String, dynamic> toJson() {
    final normalizedImages = <String, String>{};

    for (final role in const ['front', 'side', 'back']) {
      final image = images[role]?.trim();
      if (image != null && image.isNotEmpty) {
        normalizedImages[role] = image;
      }
    }

    final normalizedGender = gender.trim().isEmpty ? 'unisex' : gender.trim();
    final normalizedScene = scene.trim();
    final normalizedWeatherConstraints = weatherConstraints
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toSet()
        .toList(growable: false);

    final immutableUserInput = request.trim();
    return {
      'height': height,
      'weight': weight,
      'scene': normalizedScene,
      'request': immutableUserInput,
      'user_input': immutableUserInput,
      'gender': normalizedGender,
      'item_budget': itemBudget,
      'outfit_budget': outfitBudget,
      'images': normalizedImages,
      'context': {
        'scene': normalizedScene,
        'location': Map<String, dynamic>.from(location),
        'weather': Map<String, dynamic>.from(weather),
        'weather_constraints': normalizedWeatherConstraints,
        'body_profile': {
          ...bodyProfile,
          'height': height,
          'weight': weight,
          'gender': normalizedGender,
        },
        'gender': normalizedGender,
      },
    };
  }
}
