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
  });

  final double height;
  final double weight;
  final String scene;
  final String request;
  final Map<String, String> images;
  final String gender;
  final String itemBudget;
  final String outfitBudget;

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
      'gender': gender.trim().isEmpty ? 'unisex' : gender.trim(),
      'item_budget': itemBudget,
      'outfit_budget': outfitBudget,
      'images': normalizedImages,
    };
  }
}
