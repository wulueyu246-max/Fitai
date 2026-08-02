class OutfitRequest {
  const OutfitRequest({
    required this.height,
    required this.weight,
    required this.scene,
    required this.request,
    required this.images,
  });

  final double height;
  final double weight;
  final String scene;
  final String request;
  final Map<String, String> images;

  Map<String, dynamic> toJson() {
    final normalizedImages = <String, String>{};

    for (final role in const ['front', 'side', 'back']) {
      final image = images[role]?.trim();
      if (image != null && image.isNotEmpty) {
        normalizedImages[role] = image;
      }
    }

    return {
      'height': height,
      'weight': weight,
      'scene': scene.trim(),
      'request': request.trim(),
      'images': normalizedImages,
    };
  }
}
