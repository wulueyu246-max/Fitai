class ProductCategory {
  const ProductCategory._();

  static const tee = 'T恤';
  static const shirt = '衬衫';
  static const outerwear = '外套';
  static const top = '上衣';
  static const bottom = '裤子';
  static const shoes = '鞋';
  static const accessories = '配饰';

  /// Virtual wardrobe slots. T-shirts and shirts both occupy the top slot.
  static const values = [
    outerwear,
    top,
    bottom,
    shoes,
    accessories,
  ];

  static const catalogValues = [
    tee,
    shirt,
    outerwear,
    bottom,
    shoes,
  ];
}

class Product {
  const Product({
    required this.id,
    required this.sku,
    required this.brand,
    required this.name,
    required this.category,
    required this.imageUrl,
    required this.color,
    required this.size,
    required this.material,
    required this.price,
    required String buyUrl,
    required this.stock,
    required this.description,
    required this.style,
    required this.season,
    required this.fitType,
    required this.aiReason,
    this.styleTags = const [],
    this.tryOnAvailable = true,
    this.isAvailable = true,
    this.affiliateChannelId = 'fitai-mvp',
    this.sourceProvider = 'mock-catalog',
    String? purchaseUrl,
    double? commission,
    double? commissionRate,
  })  : purchaseUrl = purchaseUrl ?? buyUrl,
        commissionRate = commissionRate ?? commission ?? 0;

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: _readString(json, 'id'),
      sku: _readOptionalAliasedString(
        json,
        ['sku', 'sku_id'],
        fallback: _readString(json, 'id'),
      ),
      brand: _readString(json, 'brand'),
      name: _readString(json, 'name'),
      category: _readString(json, 'category'),
      imageUrl: _readAliasedString(json, ['imageUrl', 'image_url', 'image']),
      color: _readOptionalAliasedString(
        json,
        ['color'],
        fallback: '以商品页为准',
      ),
      size: _readOptionalAliasedString(
        json,
        ['size', 'sizes'],
        fallback: '均码',
      ),
      material: _readOptionalAliasedString(
        json,
        ['material', 'fabric'],
        fallback: '混合材质',
      ),
      price: _readString(json, 'price'),
      buyUrl: _readOptionalAliasedString(
        json,
        ['purchaseUrl', 'purchase_url', 'buyUrl', 'buy_url'],
        fallback: '',
      ),
      stock: _readOptionalInt(
        json,
        ['stock', 'inventory'],
        fallback: 1,
      ),
      description: _readOptionalAliasedString(
        json,
        ['description'],
        fallback: '品牌联盟商品，详细信息以品牌购买页面为准。',
      ),
      style: json['style'] is String ? json['style'] as String : '百搭',
      season: json['season'] is String ? json['season'] as String : '四季',
      fitType: _readOptionalAliasedString(
        json,
        ['fitType', 'fit_type'],
        fallback: '常规版型',
      ),
      aiReason: _readOptionalAliasedString(
        json,
        ['aiReason', 'ai_reason', 'reason', 'fit_reason'],
        fallback: '根据你的身体比例与风格偏好进行匹配。',
      ),
      styleTags: (json['styleTags'] as List<dynamic>? ??
              json['style_tags'] as List<dynamic>? ??
              const [])
          .whereType<String>()
          .toList(growable: false),
      commissionRate: _readOptionalDouble(
        json,
        ['commissionRate', 'commission_rate', 'commission'],
      ),
      affiliateChannelId: _readOptionalAliasedString(
        json,
        ['affiliateChannelId', 'affiliate_channel_id', 'channelId'],
        fallback: 'fitai-mvp',
      ),
      sourceProvider: _readOptionalAliasedString(
        json,
        ['sourceProvider', 'source_provider', 'provider'],
        fallback: 'remote-catalog',
      ),
      tryOnAvailable: json['tryOnAvailable'] as bool? ??
          json['try_on_available'] as bool? ??
          true,
      isAvailable:
          json['isAvailable'] as bool? ?? json['is_available'] as bool? ?? true,
    );
  }

  factory Product.fromAiRecommendation(
    Map<String, dynamic> json, {
    required int index,
  }) {
    final category = _readString(json, 'category').trim();
    final name = _readString(json, 'name').trim();
    final reason = _readOptionalAliasedString(
      json,
      ['reason', 'aiReason', 'ai_reason', 'fit_reason'],
      fallback: '根据你的身体比例、风格和使用场景生成。',
    ).trim();

    return Product(
      id: 'ai-suggestion-$index',
      sku: 'AI-SUGGESTION-$index',
      brand: 'AI 穿搭建议',
      name: name,
      category: category,
      imageUrl: _aiPlaceholderImage(category),
      color: _readOptionalAliasedString(
        json,
        ['color'],
        fallback: '按建议选择',
      ),
      size: '按实际商品选择',
      material: _readOptionalAliasedString(
        json,
        ['material', 'fabric'],
        fallback: '按建议选择',
      ),
      price: '0',
      buyUrl: '',
      stock: 0,
      description: reason,
      style: 'AI 个性建议',
      season: '按场景选择',
      fitType: reason,
      aiReason: reason,
      tryOnAvailable: false,
      isAvailable: false,
      sourceProvider: 'ai-analysis',
      affiliateChannelId: '',
    );
  }

  final String id;
  final String sku;
  final String brand;
  final String name;
  final String category;
  final String imageUrl;
  final String color;
  final String size;
  final String material;
  final String price;
  final String purchaseUrl;
  final double commissionRate;
  final String affiliateChannelId;
  final String sourceProvider;
  final int stock;
  final String description;
  final String style;
  final String season;
  final String fitType;
  final String aiReason;
  final List<String> styleTags;
  final bool tryOnAvailable;
  final bool isAvailable;

  String get displayPrice => numericPrice <= 0 ? '价格待匹配' : '¥$price';
  String get image => imageUrl;
  String get buyUrl => purchaseUrl;
  double get commission => commissionRate;
  String get commissionLabel => commissionRate <= 0
      ? '无佣金'
      : '${(commissionRate * 100).toStringAsFixed(1)}%';
  double get numericPrice {
    final normalized = price.replaceAll(RegExp(r'[^0-9.]'), '');
    return double.tryParse(normalized) ?? 0;
  }

  double get estimatedCommission => numericPrice * commissionRate;
  bool get inStock => stock > 0;
  bool get isPurchasable => isAvailable && inStock && purchaseUrl.isNotEmpty;
  List<String> get effectiveStyleTags => styleTags.isEmpty
      ? List<String>.unmodifiable({style, fitType, season})
      : styleTags;
  String get wardrobeSlot {
    if (category == ProductCategory.tee ||
        category == ProductCategory.shirt ||
        category == ProductCategory.top) {
      return ProductCategory.top;
    }
    return category;
  }

  /// Backward-compatible alias for older UI and cached payloads.
  String get reason => aiReason;

  bool get isNetworkImage {
    final uri = Uri.tryParse(imageUrl);
    return uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
  }

  Product copyWith({
    String? id,
    String? sku,
    String? brand,
    String? name,
    String? category,
    String? imageUrl,
    String? color,
    String? size,
    String? material,
    String? price,
    String? buyUrl,
    String? purchaseUrl,
    int? stock,
    String? description,
    String? style,
    String? season,
    String? fitType,
    String? aiReason,
    List<String>? styleTags,
    bool? tryOnAvailable,
    bool? isAvailable,
    String? affiliateChannelId,
    String? sourceProvider,
    double? commission,
    double? commissionRate,
  }) {
    return Product(
      id: id ?? this.id,
      sku: sku ?? this.sku,
      brand: brand ?? this.brand,
      name: name ?? this.name,
      category: category ?? this.category,
      imageUrl: imageUrl ?? this.imageUrl,
      color: color ?? this.color,
      size: size ?? this.size,
      material: material ?? this.material,
      price: price ?? this.price,
      buyUrl: purchaseUrl ?? buyUrl ?? this.purchaseUrl,
      stock: stock ?? this.stock,
      description: description ?? this.description,
      style: style ?? this.style,
      season: season ?? this.season,
      fitType: fitType ?? this.fitType,
      aiReason: aiReason ?? this.aiReason,
      styleTags: styleTags ?? this.styleTags,
      tryOnAvailable: tryOnAvailable ?? this.tryOnAvailable,
      isAvailable: isAvailable ?? this.isAvailable,
      affiliateChannelId: affiliateChannelId ?? this.affiliateChannelId,
      sourceProvider: sourceProvider ?? this.sourceProvider,
      commissionRate: commissionRate ?? commission ?? this.commissionRate,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'sku': sku,
      'brand': brand,
      'name': name,
      'category': category,
      'image': imageUrl,
      'imageUrl': imageUrl,
      'color': color,
      'size': size,
      'material': material,
      'price': price,
      'buyUrl': buyUrl,
      'purchaseUrl': purchaseUrl,
      'commission': commissionRate,
      'commissionRate': commissionRate,
      'affiliateChannelId': affiliateChannelId,
      'sourceProvider': sourceProvider,
      'stock': stock,
      'description': description,
      'style': style,
      'season': season,
      'fitType': fitType,
      'aiReason': aiReason,
      'styleTags': styleTags,
      'tryOnAvailable': tryOnAvailable,
      'isAvailable': isAvailable,
    };
  }

  static String _readString(Map<String, dynamic> json, String key) {
    final value = json[key];

    if (value is! String) {
      throw FormatException('缺少字符串字段：$key');
    }

    return value;
  }

  static String _aiPlaceholderImage(String category) {
    if (category.contains('鞋')) {
      return 'assets/images/products/leather_loafers.jpg';
    }
    if (category.contains('裤') || category.contains('下装')) {
      return 'assets/images/products/pleated_trousers.jpg';
    }
    if (category.contains('配饰') || category.contains('包')) {
      return 'assets/images/products/minimal_watch.jpg';
    }
    if (category.contains('上衣') || category.contains('衬衫')) {
      return 'assets/images/products/structured_shirt.jpg';
    }
    return 'assets/images/products/tailored_blazer.jpg';
  }

  static String _readAliasedString(
    Map<String, dynamic> json,
    List<String> keys,
  ) {
    for (final key in keys) {
      final value = json[key];

      if (value is String) {
        return value;
      }
    }

    throw FormatException('缺少字符串字段：${keys.join('/')}');
  }

  static String _readOptionalAliasedString(
    Map<String, dynamic> json,
    List<String> keys, {
    required String fallback,
  }) {
    for (final key in keys) {
      final value = json[key];
      if (value is String && value.trim().isNotEmpty) {
        return value;
      }
    }
    return fallback;
  }

  static int _readOptionalInt(
    Map<String, dynamic> json,
    List<String> keys, {
    int fallback = 0,
  }) {
    for (final key in keys) {
      final value = json[key];
      if (value is int) {
        return value;
      }
      if (value is num) {
        return value.toInt();
      }
    }
    return fallback;
  }

  static double _readOptionalDouble(
    Map<String, dynamic> json,
    List<String> keys, {
    double fallback = 0,
  }) {
    for (final key in keys) {
      final value = json[key];
      if (value is num) {
        return value.toDouble();
      }
      final parsed = double.tryParse(value?.toString() ?? '');
      if (parsed != null) {
        return parsed;
      }
    }
    return fallback;
  }
}
