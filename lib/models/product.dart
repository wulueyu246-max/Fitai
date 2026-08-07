class ProductCategory {
  const ProductCategory._();

  static const top = 'top';
  static const bottom = 'bottom';
  static const dress = 'dress';
  static const shoes = 'shoes';
  static const outerwear = 'outerwear';
  static const accessories = 'accessories';

  /// Legacy subtype aliases now share the stable top slot.
  static const tee = top;
  static const shirt = top;

  /// Virtual wardrobe slots. T-shirts and shirts both occupy the top slot.
  static const values = [
    top,
    bottom,
    dress,
    shoes,
    outerwear,
    accessories,
  ];

  static const catalogValues = values;

  static String normalize(String value) {
    final normalized = value.trim().toLowerCase();
    if (normalized.isEmpty) return '';
    if (RegExp(r'连衣裙|礼服裙|裙装').hasMatch(normalized) ||
        RegExp(r'(^|[^a-z])dress([^a-z]|$)').hasMatch(normalized)) {
      return dress;
    }
    if (RegExp(r't恤|短袖|衬衫|上衣|上装').hasMatch(normalized) ||
        RegExp(r'(^|[^a-z])(t-?shirt|tshirt|shirt|tee|upper|top)([^a-z]|$)')
            .hasMatch(normalized)) {
      return top;
    }
    if (RegExp(r'裤|下装|裙').hasMatch(normalized) ||
        RegExp(r'(^|[^a-z])(pants|trousers|trouser|skirt|bottom)([^a-z]|$)')
            .hasMatch(normalized)) {
      return bottom;
    }
    if (RegExp(r'鞋|乐福').hasMatch(normalized) ||
        RegExp(r'(^|[^a-z])(shoe|shoes|sneaker|sneakers|loafer|loafers)([^a-z]|$)')
            .hasMatch(normalized)) {
      return shoes;
    }
    if (RegExp(r'外套|夹克|西装|大衣').hasMatch(normalized) ||
        RegExp(r'(^|[^a-z])(coat|jacket|blazer|outerwear)([^a-z]|$)')
            .hasMatch(normalized)) {
      return outerwear;
    }
    if (RegExp(r'配饰|包|帽|围巾').hasMatch(normalized) ||
        RegExp(r'(^|[^a-z])(accessory|accessories|bag|hat|scarf)([^a-z]|$)')
            .hasMatch(normalized)) {
      return accessories;
    }
    return values.contains(normalized) ? normalized : normalized;
  }

  static String label(String slot) {
    return switch (normalize(slot)) {
      top => '上衣推荐',
      bottom => '下装推荐',
      dress => '连衣裙推荐',
      shoes => '鞋履推荐',
      outerwear => '外套推荐',
      accessories => '配饰推荐',
      _ => '其他推荐',
    };
  }
}

String normalizeProductImageUrl(Object? value) {
  final raw = value?.toString().trim() ?? '';
  if (raw.isEmpty) return '';
  final candidate = raw.startsWith('//') ? 'https:$raw' : raw;
  final uri = Uri.tryParse(candidate);
  if (uri == null ||
      !{'http', 'https'}.contains(uri.scheme.toLowerCase()) ||
      uri.host.isEmpty ||
      !_isPublicImageHost(uri.host)) {
    return '';
  }
  return uri.toString();
}

bool _isPublicImageHost(String host) {
  final normalized = host.toLowerCase();
  if (normalized == 'localhost' ||
      normalized.endsWith('.localhost') ||
      normalized == '0.0.0.0' ||
      normalized == '::1') {
    return false;
  }
  final octets = normalized.split('.').map(int.tryParse).toList();
  if (octets.length == 4 && octets.every((part) => part != null)) {
    final first = octets[0]!;
    final second = octets[1]!;
    return first != 10 &&
        first != 127 &&
        !(first == 169 && second == 254) &&
        !(first == 172 && second >= 16 && second <= 31) &&
        !(first == 192 && second == 168);
  }
  return true;
}

class ProductQualityBlock {
  const ProductQualityBlock({
    required this.blockedCategory,
    required this.blockedKeyword,
  });

  final String blockedCategory;
  final String blockedKeyword;
}

const Map<String, List<String>> _lowValueLookProductTerms = {
  'underwear': ['内裤', '文胸', '胸罩', '内衣', '安全裤', '塑身衣', '塑身裤'],
  'hosiery': ['袜子', '丝袜', '连裤袜', '打底袜', '船袜', '长筒袜'],
  'homewear': ['睡衣', '家居服', '睡袍', '浴袍'],
  'adult': ['情趣用品', '情趣内衣', '性感内衣'],
  'swimwear': ['泳衣', '泳装', '泳裤', '比基尼'],
};

ProductQualityBlock? lookProductQualityBlock(
  Product product, {
  String explicitSearchKeyword = '',
}) {
  final explicitSearch = explicitSearchKeyword.trim().toLowerCase();
  final explicitlyRequested = explicitSearch.isNotEmpty &&
      _lowValueLookProductTerms.values
          .expand((terms) => terms)
          .any(explicitSearch.contains);
  if (explicitlyRequested) return null;

  final evidence = '${product.name} ${product.category}'.toLowerCase();
  for (final entry in _lowValueLookProductTerms.entries) {
    for (final keyword in entry.value) {
      if (evidence.contains(keyword)) {
        return ProductQualityBlock(
          blockedCategory: entry.key,
          blockedKeyword: keyword,
        );
      }
    }
  }
  return null;
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
    this.originalPrice,
    this.couponAmount = 0,
    this.shopName = '',
    this.sales,
    this.recommendationReason = '',
    this.matchExplanation = '',
    this.relevanceScore = 0,
    this.aestheticScore = 0,
    this.brandQualityScore = 0,
    this.diversityScore = 0,
    this.aiTasteScore = 0,
    this.fitScore = 0,
    this.outfitCoherenceScore = 0,
    this.valueScore = 0,
    this.finalScore = 0,
    this.aiRecommendationReason = '',
    this.aiConcern = '',
    this.aiLabel = '',
    this.aiRerankFallback = false,
    this.brandFallback = false,
    this.isMock = false,
    this.requestId,
    this.lookId = '',
    String? purchaseUrl,
    double? commission,
    double? commissionRate,
  })  : purchaseUrl = purchaseUrl ?? buyUrl,
        commissionRate = commissionRate ?? commission ?? 0;

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: _readAliasedString(json, ['id', 'product_id', 'productId']),
      sku: _readOptionalAliasedString(
        json,
        ['sku', 'sku_id'],
        fallback: _readAliasedString(json, ['id', 'product_id', 'productId']),
      ),
      brand: _readOptionalAliasedString(
        json,
        ['brand'],
        fallback: '精选商品',
      ),
      name: _readAliasedString(json, ['name', 'title']),
      category: ProductCategory.normalize(_readString(json, 'category')),
      imageUrl: normalizeProductImageUrl(
        _readOptionalAliasedString(
          json,
          ['imageUrl', 'image_url', 'image'],
          fallback: '',
        ),
      ),
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
      price: _readPrice(json, 'price'),
      buyUrl: _readOptionalAliasedString(
        json,
        [
          'purchaseUrl',
          'purchase_url',
          'affiliate_url',
          'affiliateUrl',
          'buyUrl',
          'buy_url',
        ],
        fallback: '',
      ),
      stock: _readOptionalInt(
        json,
        ['stock', 'inventory'],
        fallback:
            _isInStock(json['stock_status'] ?? json['stockStatus']) ? 1 : 0,
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
              json['tags'] as List<dynamic>? ??
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
        ['sourceProvider', 'source_provider', 'source', 'provider', 'platform'],
        fallback: 'remote-catalog',
      ),
      originalPrice: _readOptionalPrice(
        json,
        ['originalPrice', 'original_price'],
      ),
      couponAmount: _readOptionalDouble(
        json,
        ['couponAmount', 'coupon_amount'],
      ),
      shopName: _readOptionalAliasedString(
        json,
        ['shopName', 'shop_name'],
        fallback: '',
      ),
      sales: _readOptionalAliasedString(
        json,
        ['sales', 'volume', 'annual_vol', 'tk_total_sales'],
        fallback: '',
      ).trim().isEmpty
          ? null
          : _readOptionalAliasedString(
              json,
              ['sales', 'volume', 'annual_vol', 'tk_total_sales'],
              fallback: '',
            ),
      recommendationReason: _readOptionalAliasedString(
        json,
        ['recommendationReason', 'recommendation_reason'],
        fallback: '',
      ),
      matchExplanation: _readOptionalAliasedString(
        json,
        ['matchExplanation', 'match_explanation'],
        fallback: '',
      ),
      relevanceScore: _readOptionalDouble(
        json,
        ['relevanceScore', 'relevance_score'],
      ),
      aestheticScore: _readOptionalDouble(
        json,
        ['aestheticScore', 'aesthetic_score'],
      ),
      brandQualityScore: _readOptionalDouble(
        json,
        ['brandQualityScore', 'brand_quality_score'],
      ),
      diversityScore: _readOptionalDouble(
        json,
        ['diversityScore', 'diversity_score'],
      ),
      aiTasteScore: _readOptionalDouble(
        json,
        ['aiTasteScore', 'ai_taste_score'],
      ),
      fitScore: _readOptionalDouble(json, ['fitScore', 'fit_score']),
      outfitCoherenceScore: _readOptionalDouble(
        json,
        ['outfitCoherenceScore', 'outfit_coherence_score'],
      ),
      valueScore: _readOptionalDouble(json, ['valueScore', 'value_score']),
      finalScore: _readOptionalDouble(
        json,
        ['finalScore', 'final_score', 'ai_match_score'],
      ),
      aiRecommendationReason: _readOptionalAliasedString(
        json,
        ['aiRecommendationReason', 'ai_recommendation_reason'],
        fallback: '',
      ),
      aiConcern: _readOptionalAliasedString(
        json,
        ['aiConcern', 'ai_concern'],
        fallback: '',
      ),
      aiLabel: _readOptionalAliasedString(
        json,
        ['aiLabel', 'ai_label'],
        fallback: '',
      ),
      aiRerankFallback: json['aiRerankFallback'] as bool? ??
          json['ai_rerank_fallback'] as bool? ??
          false,
      brandFallback: json['brandFallback'] as bool? ??
          json['brand_fallback'] as bool? ??
          false,
      isMock: json['isMock'] as bool? ??
          json['is_mock'] as bool? ??
          _looksLikeMockSource(json),
      requestId: _readOptionalAliasedString(
        json,
        ['requestId', 'request_id'],
        fallback: '',
      ),
      lookId: _readOptionalAliasedString(
        json,
        ['lookId', 'look_id'],
        fallback: '',
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
    final category = ProductCategory.normalize(_readString(json, 'category'));
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
  final String? originalPrice;
  final double couponAmount;
  final String shopName;
  final String? sales;
  final String recommendationReason;
  final String matchExplanation;
  final double relevanceScore;
  final double aestheticScore;
  final double brandQualityScore;
  final double diversityScore;
  final double aiTasteScore;
  final double fitScore;
  final double outfitCoherenceScore;
  final double valueScore;
  final double finalScore;
  final String aiRecommendationReason;
  final String aiConcern;
  final String aiLabel;
  final bool aiRerankFallback;
  final bool brandFallback;
  final bool isMock;
  final String? requestId;
  final String lookId;
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
  String? get displayOriginalPrice {
    final value = _numericValue(originalPrice ?? '');
    return value > numericPrice ? '¥$originalPrice' : null;
  }

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
  bool get isPurchasable {
    final uri = Uri.tryParse(purchaseUrl);
    return !isMock &&
        isAvailable &&
        inStock &&
        uri != null &&
        uri.scheme == 'https' &&
        uri.host.isNotEmpty;
  }

  List<String> get effectiveStyleTags => styleTags.isEmpty
      ? List<String>.unmodifiable({style, fitType, season})
      : styleTags;
  String get wardrobeSlot {
    return ProductCategory.normalize(category);
  }

  /// Backward-compatible alias for older UI and cached payloads.
  String get reason => aiReason;

  bool get hasAiTasteSelection => !aiRerankFallback && finalScore > 0;
  bool get isAllowedForLookRecommendation =>
      lookProductQualityBlock(this) == null;
  String get displayRecommendationReason => aiRecommendationReason.isNotEmpty
      ? aiRecommendationReason
      : recommendationReason.isNotEmpty
          ? recommendationReason
          : aiReason;

  bool get isNetworkImage {
    return normalizeProductImageUrl(imageUrl).isNotEmpty;
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
    String? originalPrice,
    double? couponAmount,
    String? shopName,
    String? sales,
    String? recommendationReason,
    String? matchExplanation,
    double? relevanceScore,
    double? aestheticScore,
    double? brandQualityScore,
    double? diversityScore,
    double? aiTasteScore,
    double? fitScore,
    double? outfitCoherenceScore,
    double? valueScore,
    double? finalScore,
    String? aiRecommendationReason,
    String? aiConcern,
    String? aiLabel,
    bool? aiRerankFallback,
    bool? brandFallback,
    bool? isMock,
    String? requestId,
    String? lookId,
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
      originalPrice: originalPrice ?? this.originalPrice,
      couponAmount: couponAmount ?? this.couponAmount,
      shopName: shopName ?? this.shopName,
      sales: sales ?? this.sales,
      recommendationReason: recommendationReason ?? this.recommendationReason,
      matchExplanation: matchExplanation ?? this.matchExplanation,
      relevanceScore: relevanceScore ?? this.relevanceScore,
      aestheticScore: aestheticScore ?? this.aestheticScore,
      brandQualityScore: brandQualityScore ?? this.brandQualityScore,
      diversityScore: diversityScore ?? this.diversityScore,
      aiTasteScore: aiTasteScore ?? this.aiTasteScore,
      fitScore: fitScore ?? this.fitScore,
      outfitCoherenceScore: outfitCoherenceScore ?? this.outfitCoherenceScore,
      valueScore: valueScore ?? this.valueScore,
      finalScore: finalScore ?? this.finalScore,
      aiRecommendationReason:
          aiRecommendationReason ?? this.aiRecommendationReason,
      aiConcern: aiConcern ?? this.aiConcern,
      aiLabel: aiLabel ?? this.aiLabel,
      aiRerankFallback: aiRerankFallback ?? this.aiRerankFallback,
      brandFallback: brandFallback ?? this.brandFallback,
      isMock: isMock ?? this.isMock,
      requestId: requestId ?? this.requestId,
      lookId: lookId ?? this.lookId,
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
      'originalPrice': originalPrice,
      'couponAmount': couponAmount,
      'shopName': shopName,
      'sales': sales,
      'recommendationReason': recommendationReason,
      'matchExplanation': matchExplanation,
      'relevanceScore': relevanceScore,
      'aestheticScore': aestheticScore,
      'brandQualityScore': brandQualityScore,
      'diversityScore': diversityScore,
      'aiTasteScore': aiTasteScore,
      'fitScore': fitScore,
      'outfitCoherenceScore': outfitCoherenceScore,
      'valueScore': valueScore,
      'finalScore': finalScore,
      'aiRecommendationReason': aiRecommendationReason,
      'aiConcern': aiConcern,
      'aiLabel': aiLabel,
      'aiRerankFallback': aiRerankFallback,
      'brandFallback': brandFallback,
      'isMock': isMock,
      'requestId': requestId,
      'lookId': lookId,
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

  static String _readPrice(Map<String, dynamic> json, String key) {
    final value = json[key];
    if (value is num && value.isFinite && value >= 0) {
      return value == value.roundToDouble()
          ? value.toStringAsFixed(0)
          : value.toStringAsFixed(2);
    }
    if (value is String && value.trim().isNotEmpty) {
      return value.trim();
    }
    throw FormatException('缺少价格字段：$key');
  }

  static String? _readOptionalPrice(
    Map<String, dynamic> json,
    List<String> keys,
  ) {
    for (final key in keys) {
      final value = json[key];
      if (value is num && value.isFinite && value > 0) {
        return value == value.roundToDouble()
            ? value.toStringAsFixed(0)
            : value.toStringAsFixed(2);
      }
      if (value is String && _numericValue(value) > 0) {
        return value.trim();
      }
    }
    return null;
  }

  static double _numericValue(String value) {
    return double.tryParse(value.replaceAll(RegExp(r'[^0-9.]'), '')) ?? 0;
  }

  static bool _isInStock(Object? value) {
    final status = value?.toString().trim().toLowerCase();
    return !{'out_of_stock', 'sold_out', 'unavailable'}.contains(status);
  }

  static bool _looksLikeMockSource(Map<String, dynamic> json) {
    final source = json['source'] ??
        json['sourceProvider'] ??
        json['source_provider'] ??
        json['platform'];
    return source?.toString().toLowerCase().contains('mock') ?? false;
  }

  static String _aiPlaceholderImage(String category) {
    final slot = ProductCategory.normalize(category);
    if (slot == ProductCategory.shoes) {
      return 'assets/images/products/leather_loafers.jpg';
    }
    if (slot == ProductCategory.bottom) {
      return 'assets/images/products/pleated_trousers.jpg';
    }
    if (slot == ProductCategory.accessories) {
      return 'assets/images/products/minimal_watch.jpg';
    }
    if (slot == ProductCategory.top) {
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
