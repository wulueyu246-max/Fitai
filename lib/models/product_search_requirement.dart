class ProductSearchRequirement {
  const ProductSearchRequirement({
    this.lookId = '',
    required this.category,
    required this.gender,
    required this.itemName,
    required this.color,
    this.fit = '',
    this.material = '',
    required this.style,
    required this.season,
    required this.scene,
    required this.searchKeywords,
    required this.negativeKeywords,
    this.blueprintRequired = false,
    this.queryReason = '',
    this.sourceElements = const [],
    this.translatedQueries = const [],
  });

  factory ProductSearchRequirement.fromJson(
    Map<String, dynamic> json, {
    String fallbackGender = 'unisex',
  }) {
    final legacyKeyword = _optionalString(json['keyword']);
    final itemName = _optionalString(json['item_name']) ??
        _optionalString(json['itemName']) ??
        _optionalString(json['name']) ??
        legacyKeyword;
    if (itemName == null) {
      throw const FormatException('Missing product item_name');
    }
    final rawSearchKeywords = json['search_keywords'] ??
        json['searchKeywords'] ??
        (legacyKeyword == null ? const <String>[] : [legacyKeyword]);
    return ProductSearchRequirement(
      lookId: _optionalString(json['look_id']) ??
          _optionalString(json['lookId']) ??
          '',
      category: _requiredString(json['category'], 'category'),
      gender: _normalizeGender(
        _optionalString(json['gender']) ?? fallbackGender,
      ),
      itemName: itemName,
      color: _optionalString(json['color']) ?? '',
      fit: _optionalString(json['fit']) ?? '',
      material: _optionalString(json['material']) ?? '',
      style: _optionalString(json['style']) ?? '',
      season: _optionalString(json['season']) ?? '',
      scene: _optionalString(json['scene']) ?? '',
      searchKeywords: _stringList(rawSearchKeywords, 'search_keywords'),
      negativeKeywords: _stringList(
        json['negative_keywords'] ?? json['negativeKeywords'] ?? const [],
        'negative_keywords',
      ),
      blueprintRequired: json['blueprint_required'] == true ||
          json['blueprintRequired'] == true,
      queryReason: _optionalString(
            json['query_reason'] ?? json['queryReason'],
          ) ??
          '',
      sourceElements: _stringList(
        json['source_elements'] ?? json['sourceElements'] ?? const [],
        'source_elements',
      ),
      translatedQueries: _translatedQueries(
        json['translated_queries'] ?? json['translatedQueries'],
      ),
    );
  }

  final String lookId;
  final String category;
  final String gender;
  final String itemName;
  final String color;
  final String fit;
  final String material;
  final String style;
  final String season;
  final String scene;
  final List<String> searchKeywords;
  final List<String> negativeKeywords;
  final bool blueprintRequired;
  final String queryReason;
  final List<String> sourceElements;
  final List<ProductSearchTranslation> translatedQueries;

  Map<String, dynamic> toJson() => {
        'look_id': lookId,
        'category': category,
        'gender': gender,
        'item_name': itemName,
        'color': color,
        'fit': fit,
        'material': material,
        'style': style,
        'season': season,
        'scene': scene,
        'search_keywords': searchKeywords,
        'negative_keywords': negativeKeywords,
        'blueprint_required': blueprintRequired,
        'query_reason': queryReason,
        'source_elements': sourceElements,
        'translated_queries': translatedQueries
            .map((translation) => translation.toJson())
            .toList(growable: false),
      };

  static String _requiredString(Object? value, String field) {
    final result = _optionalString(value);
    if (result == null) throw FormatException('Missing product $field');
    return result;
  }

  static String? _optionalString(Object? value) {
    return value is String && value.trim().isNotEmpty ? value.trim() : null;
  }

  static String _normalizeGender(String value) {
    final normalized = value.trim().toLowerCase();
    if (const {'male', 'man', 'men', '男性', '男士', '男生'}.contains(normalized)) {
      return 'male';
    }
    if (const {'female', 'woman', 'women', '女性', '女士', '女生'}
        .contains(normalized)) {
      return 'female';
    }
    return 'unisex';
  }

  static List<String> _stringList(Object? value, String field) {
    if (value is! List) throw FormatException('$field must be an array');
    final values = value
        .whereType<String>()
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
    if (values.length != value.length) {
      throw FormatException('$field must contain strings');
    }
    return values;
  }

  static List<ProductSearchTranslation> _translatedQueries(Object? value) {
    if (value == null) return const [];
    if (value is! List) {
      throw const FormatException('translated_queries must be an array');
    }
    return List<ProductSearchTranslation>.unmodifiable(
      value.map((entry) {
        if (entry is! Map<String, dynamic>) {
          throw const FormatException(
            'translated_queries entries must be objects',
          );
        }
        return ProductSearchTranslation.fromJson(entry);
      }),
    );
  }
}

class ProductSearchTranslation {
  const ProductSearchTranslation({
    required this.category,
    required this.query,
    required this.sourceElements,
    required this.queryReason,
  });

  factory ProductSearchTranslation.fromJson(Map<String, dynamic> json) {
    return ProductSearchTranslation(
      category:
          json['category'] is String ? (json['category'] as String).trim() : '',
      query: json['query'] is String ? (json['query'] as String).trim() : '',
      sourceElements: ProductSearchRequirement._stringList(
        json['source_elements'] ?? json['sourceElements'] ?? const [],
        'translated_queries.source_elements',
      ),
      queryReason: json['query_reason'] is String
          ? (json['query_reason'] as String).trim()
          : json['queryReason'] is String
              ? (json['queryReason'] as String).trim()
              : '',
    );
  }

  final String category;
  final String query;
  final List<String> sourceElements;
  final String queryReason;

  Map<String, dynamic> toJson() => {
        'category': category,
        'query': query,
        'source_elements': sourceElements,
        'query_reason': queryReason,
      };
}
