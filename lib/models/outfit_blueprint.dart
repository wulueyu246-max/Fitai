class OutfitBlueprint {
  const OutfitBlueprint({
    this.blueprintSource = 'ai_generated',
    this.styleIdentity = '',
    this.characterImpression = '',
    this.visualKeywords = const [],
    this.coreElements = const [],
    this.silhouetteStrategy = const [],
    this.colorPalette = const [],
    this.materialDirection = const [],
    this.mustHaveItems = const {},
    this.avoidItems = const [],
    this.occasionStrategy = '',
  });

  factory OutfitBlueprint.fromJson(Object? value) {
    if (value == null) return const OutfitBlueprint();
    if (value is! Map<String, dynamic>) {
      throw const FormatException('outfit_blueprint 必须是对象');
    }
    final rawItems = value['must_have_items'] ?? value['mustHaveItems'];
    final items = <String, List<String>>{};
    if (rawItems is Map) {
      for (final entry in rawItems.entries) {
        final key = entry.key.toString().trim();
        if (key.isEmpty) continue;
        items[key] = _stringList(entry.value);
      }
    }
    return OutfitBlueprint(
      blueprintSource: _text(
        value['blueprint_source'] ?? value['blueprintSource'],
      ).isEmpty
          ? 'ai_generated'
          : _text(value['blueprint_source'] ?? value['blueprintSource']),
      styleIdentity: _text(value['style_identity'] ?? value['styleIdentity']),
      characterImpression: _text(
        value['character_impression'] ?? value['characterImpression'],
      ),
      visualKeywords: _stringList(
        value['visual_keywords'] ?? value['visualKeywords'],
      ),
      coreElements: _stringList(
        value['core_elements'] ?? value['coreElements'],
      ),
      silhouetteStrategy: _stringList(
        value['silhouette_strategy'] ?? value['silhouetteStrategy'],
      ),
      colorPalette: _stringList(
        value['color_palette'] ?? value['colorPalette'],
      ),
      materialDirection: _stringList(
        value['material_direction'] ?? value['materialDirection'],
      ),
      mustHaveItems: Map<String, List<String>>.unmodifiable(
        items.map(
          (key, itemNames) => MapEntry(
            key,
            List<String>.unmodifiable(itemNames),
          ),
        ),
      ),
      avoidItems: _stringList(value['avoid_items'] ?? value['avoidItems']),
      occasionStrategy: _text(
        value['occasion_strategy'] ?? value['occasionStrategy'],
      ),
    );
  }

  final String blueprintSource;
  final String styleIdentity;
  final String characterImpression;
  final List<String> visualKeywords;
  final List<String> coreElements;
  final List<String> silhouetteStrategy;
  final List<String> colorPalette;
  final List<String> materialDirection;
  final Map<String, List<String>> mustHaveItems;
  final List<String> avoidItems;
  final String occasionStrategy;

  Map<String, dynamic> toJson() => {
        'blueprint_source': blueprintSource,
        'style_identity': styleIdentity,
        'character_impression': characterImpression,
        'visual_keywords': visualKeywords,
        'core_elements': coreElements,
        'silhouette_strategy': silhouetteStrategy,
        'color_palette': colorPalette,
        'material_direction': materialDirection,
        'must_have_items': mustHaveItems,
        'avoid_items': avoidItems,
        'occasion_strategy': occasionStrategy,
      };

  static String _text(Object? value) => value is String ? value.trim() : '';

  static List<String> _stringList(Object? value) {
    if (value == null) return const [];
    if (value is! List) return const [];
    return List<String>.unmodifiable(
      value.whereType<String>().map((item) => item.trim()).where(
            (item) => item.isNotEmpty,
          ),
    );
  }
}
