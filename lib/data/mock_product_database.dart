import '../models/product.dart';

abstract final class MockProductDatabase {
  static const affiliateChannelId = String.fromEnvironment(
    'AFFILIATE_CHANNEL_ID',
    defaultValue: 'fitai-commercial-test',
  );

  static final List<Product> products = List<Product>.unmodifiable(
    _seeds.map(_buildProduct),
  );

  static const _seeds = [
    _ProductSeed('uniqlo-tailored-blazer', 'Uniqlo', '羊毛混纺西装',
        ProductCategory.outerwear, '799', '商务', '深炭黑'),
    _ProductSeed('cos-structured-shirt', 'COS', '结构感精纺棉衬衫',
        ProductCategory.shirt, '590', '极简', '光学白'),
    _ProductSeed('ralph-lauren-navy-knit', 'COS', '精纺圆领针织衫',
        ProductCategory.tee, '690', '高级感', '海军蓝'),
    _ProductSeed('zara-pleated-trousers', 'ZARA', '高腰垂感褶裥西裤',
        ProductCategory.bottom, '399', '商务', '炭灰色'),
    _ProductSeed('clarks-leather-loafers', 'ZARA', '极简皮革乐福鞋',
        ProductCategory.shoes, '699', '通勤', '曜石黑'),
    _ProductSeed('fitai-minimal-watch', 'Shupi Select', '极简银黑腕表',
        ProductCategory.accessories, '599', '极简', '银黑色'),
    _ProductSeed('fitai-forest-tote', 'Shupi Select', '森林绿通勤托特包',
        ProductCategory.accessories, '329', '通勤', '森林绿'),
    _ProductSeed('fitai-light-cap', 'Shupi Select', '轻量简约棒球帽',
        ProductCategory.accessories, '129', '休闲', '米白色'),
    _ProductSeed('fitai-wool-scarf', 'Shupi Select', '羊毛混纺围巾',
        ProductCategory.accessories, '259', '高级感', '深灰色'),
    _ProductSeed('nike-dri-fit-tee', 'Nike', 'Dri-FIT 速干训练T恤',
        ProductCategory.tee, '249', '运动', '雾灰色'),
    _ProductSeed('adidas-training-tee', 'Adidas', 'AEROREADY 运动上衣',
        ProductCategory.tee, '269', '运动', '纯黑色'),
    _ProductSeed('zara-relaxed-overshirt', 'ZARA', '宽松廓形衬衫外套',
        ProductCategory.outerwear, '459', '街头', '岩灰色'),
    _ProductSeed('cos-clean-jacket', 'COS', 'Clean Cut 简约夹克',
        ProductCategory.outerwear, '1290', '高级感', '午夜蓝'),
    _ProductSeed('uniqlo-airism-tee', 'Uniqlo', 'AIRism 棉质圆领T恤',
        ProductCategory.tee, '199', '休闲', '米白色'),
    _ProductSeed('youyiku-oxford-shirt', '优衣库', '牛津纺宽松衬衫',
        ProductCategory.shirt, '299', '通勤', '天青色'),
    _ProductSeed('nike-tech-jacket', 'Nike', 'Tech Woven 都市夹克',
        ProductCategory.outerwear, '899', '街头', '石墨黑'),
    _ProductSeed('adidas-track-jacket', 'Adidas', '经典三叶草运动夹克',
        ProductCategory.outerwear, '699', '运动', '墨绿色'),
    _ProductSeed('zara-wide-trousers', 'ZARA', '垂感宽腿西裤', ProductCategory.bottom,
        '459', '高级感', '浅灰色'),
    _ProductSeed('cos-tapered-trousers', 'COS', '锥形精裁长裤',
        ProductCategory.bottom, '890', '极简', '深蓝色'),
    _ProductSeed('uniqlo-smart-pants', 'Uniqlo', 'Smart Ankle 九分裤',
        ProductCategory.bottom, '299', '通勤', '黑色'),
    _ProductSeed('youyiku-straight-jeans', '优衣库', '直筒赤耳牛仔裤',
        ProductCategory.bottom, '399', '休闲', '原色蓝'),
    _ProductSeed('nike-air-max', 'Nike', 'Air Max 轻量运动鞋', ProductCategory.shoes,
        '899', '运动', '银灰色'),
    _ProductSeed('adidas-samba', 'Adidas', 'Samba OG 复古板鞋',
        ProductCategory.shoes, '799', '街头', '黑白色'),
    _ProductSeed('zara-minimal-sneaker', 'ZARA', '极简皮革小白鞋',
        ProductCategory.shoes, '499', '约会', '象牙白'),
    _ProductSeed('cos-leather-derby', 'COS', '方头皮革德比鞋', ProductCategory.shoes,
        '1390', '商务', '黑色'),
    _ProductSeed('uniqlo-utility-jacket', 'Uniqlo', '轻量多口袋工装夹克',
        ProductCategory.outerwear, '499', '休闲', '卡其色'),
    _ProductSeed('nike-street-hoodie', 'Nike', 'Phoenix Fleece 连帽衫',
        ProductCategory.tee, '599', '街头', '燕麦灰'),
    _ProductSeed('adidas-knit-polo', 'Adidas', '针织运动Polo衫', ProductCategory.tee,
        '499', '休闲', '藏青色'),
    _ProductSeed('zara-date-shirt', 'ZARA', '垂感古巴领衬衫', ProductCategory.shirt,
        '359', '约会', '奶油白'),
    _ProductSeed('cos-wool-coat', 'COS', '双面羊毛长外套', ProductCategory.outerwear,
        '2290', '高级感', '驼色'),
    _ProductSeed('youyiku-light-down', '优衣库', '无缝轻型羽绒外套',
        ProductCategory.outerwear, '699', '通勤', '深灰色'),
    _ProductSeed('zara-relaxed-pants', 'ZARA', '松弛感直筒休闲裤',
        ProductCategory.bottom, '399', '约会', '沙色'),
    _ProductSeed('nike-cortez', 'Nike', 'Cortez 复古休闲鞋', ProductCategory.shoes,
        '699', '休闲', '白红色'),
    _ProductSeed('uniqlo-u-crew-tee', 'Uniqlo', 'U系列宽版圆领T恤',
        ProductCategory.tee, '149', '极简', '奶油白'),
    _ProductSeed('uniqlo-linen-shirt', 'Uniqlo', '亚麻混纺立领衬衫',
        ProductCategory.shirt, '299', '休闲', '鼠尾草绿'),
    _ProductSeed('uniqlo-blocktech-coat', 'Uniqlo', 'BLOCKTECH轻量风衣',
        ProductCategory.outerwear, '699', '通勤', '岩石灰'),
    _ProductSeed('uniqlo-wide-chino', 'Uniqlo', '宽松直筒奇诺裤',
        ProductCategory.bottom, '299', '休闲', '沙卡其'),
    _ProductSeed('nike-premium-tee', 'Nike', 'Sportswear Premium T恤',
        ProductCategory.tee, '299', '街头', '炭黑色'),
    _ProductSeed('nike-club-overshirt', 'Nike', 'Club梭织宽松衬衫',
        ProductCategory.shirt, '499', '街头', '浅卡其'),
    _ProductSeed('nike-windrunner', 'Nike', 'Windrunner轻量夹克',
        ProductCategory.outerwear, '799', '运动', '黑灰色'),
    _ProductSeed('nike-chino-pants', 'Nike', 'Life直筒梭织长裤',
        ProductCategory.bottom, '599', '街头', '橄榄绿'),
    _ProductSeed('adidas-essential-tee', 'Adidas', 'Premium Essential T恤',
        ProductCategory.tee, '269', '休闲', '象牙白'),
    _ProductSeed('adidas-oxford-shirt', 'Adidas', 'Originals牛津衬衫',
        ProductCategory.shirt, '499', '街头', '淡蓝色'),
    _ProductSeed('adidas-terrex-jacket', 'Adidas', 'TERREX城市机能外套',
        ProductCategory.outerwear, '1099', '运动', '深灰绿'),
    _ProductSeed('adidas-straight-pants', 'Adidas', 'Adicolor直筒长裤',
        ProductCategory.bottom, '499', '休闲', '深藏青'),
    _ProductSeed('zara-heavy-tee', 'ZARA', '重磅棉宽松T恤', ProductCategory.tee,
        '199', '极简', '暖白色'),
    _ProductSeed('zara-striped-shirt', 'ZARA', '细条纹垂感衬衫', ProductCategory.shirt,
        '359', '通勤', '蓝白色'),
    _ProductSeed('zara-cropped-jacket', 'ZARA', '短款结构感夹克',
        ProductCategory.outerwear, '599', '高级感', '黑色'),
    _ProductSeed('zara-straight-jeans', 'ZARA', '高腰直筒牛仔裤',
        ProductCategory.bottom, '399', '街头', '水洗蓝'),
    _ProductSeed('cos-clean-tee', 'COS', 'Clean Cut厚棉T恤', ProductCategory.tee,
        '390', '极简', '粉笔白'),
    _ProductSeed('cos-collarless-shirt', 'COS', '无领精纺棉衬衫',
        ProductCategory.shirt, '690', '高级感', '雾蓝色'),
    _ProductSeed('cos-short-wool-jacket', 'COS', '短款羊毛混纺外套',
        ProductCategory.outerwear, '1690', '高级感', '深咖色'),
    _ProductSeed('cos-barrel-trousers', 'COS', '弧形廓形长裤', ProductCategory.bottom,
        '890', '极简', '炭灰色'),
    _ProductSeed('youyiku-supima-tee', '优衣库', 'SUPIMA棉圆领T恤',
        ProductCategory.tee, '99', '休闲', '纯白色'),
    _ProductSeed('youyiku-broadcloth-shirt', '优衣库', '精纺府绸衬衫',
        ProductCategory.shirt, '249', '商务', '白色'),
    _ProductSeed('youyiku-parka', '优衣库', '轻型防风连帽外套', ProductCategory.outerwear,
        '399', '休闲', '海军蓝'),
    _ProductSeed('youyiku-pleated-pants', '优衣库', '垂感褶裥阔腿裤',
        ProductCategory.bottom, '299', '通勤', '深灰色'),
    _ProductSeed('nike-zoom-vomero', 'Nike', 'Zoom Vomero都市跑鞋',
        ProductCategory.shoes, '1199', '街头', '银白色'),
    _ProductSeed('adidas-gazelle', 'Adidas', 'Gazelle Indoor板鞋',
        ProductCategory.shoes, '899', '约会', '灰蓝色'),
    _ProductSeed('zara-runner', 'ZARA', '复古拼色运动鞋', ProductCategory.shoes, '499',
        '休闲', '米灰色'),
    _ProductSeed('cos-minimal-trainer', 'COS', '极简皮革训练鞋', ProductCategory.shoes,
        '1190', '极简', '暖白色'),
  ];

  static Product? findById(String id) {
    for (final product in products) {
      if (product.id == id) {
        return product;
      }
    }
    return null;
  }

  static Product _buildProduct(_ProductSeed seed) {
    return Product(
      id: seed.id,
      sku: 'FITAI-${seed.id.toUpperCase()}',
      brand: seed.brand,
      name: seed.name,
      category: seed.category,
      imageUrl: _imageForCategory(seed.category, seed.id),
      color: seed.color,
      size: _sizeFor(seed.category),
      material: _materialFor(seed),
      price: seed.price,
      buyUrl: _purchaseUrlFor(seed),
      commissionRate: _commissionFor(seed.brand),
      affiliateChannelId: affiliateChannelId,
      sourceProvider: 'fitai-mock-catalog',
      stock: 12 + seed.id.length % 36,
      style: seed.style,
      season: _seasonFor(seed),
      fitType: _fitTypeFor(seed),
      styleTags: [seed.style, _fitTypeFor(seed), _seasonFor(seed)],
      tryOnAvailable: seed.category != ProductCategory.accessories,
      description:
          '${seed.brand} ${seed.name}，以${seed.style}风格为核心，兼顾日常舒适度与造型完成度。',
      aiReason: _reasonFor(seed),
    );
  }

  static String _imageForCategory(String category, String id) {
    if (category == ProductCategory.accessories) {
      return 'assets/images/products/minimal_watch.jpg';
    }
    if (category == ProductCategory.outerwear) {
      return 'assets/images/products/tailored_blazer.jpg';
    }
    if (category == ProductCategory.bottom) {
      return 'assets/images/products/pleated_trousers.jpg';
    }
    if (category == ProductCategory.shoes) {
      return 'assets/images/products/leather_loafers.jpg';
    }
    return id.contains('knit') || id.contains('hoodie')
        ? 'assets/images/products/navy_knit.jpg'
        : 'assets/images/products/structured_shirt.jpg';
  }

  static String _reasonFor(_ProductSeed seed) {
    final shapeBenefit = switch (_slotFor(seed.category)) {
      ProductCategory.outerwear => '清晰肩线能增强上身轮廓，改善头肩比例',
      ProductCategory.top => '领口与直身版型能保持肩颈利落，减少上身堆叠',
      ProductCategory.bottom => '顺直裤线和腰线设计能拉长腿部视觉比例',
      ProductCategory.shoes => '简洁鞋型能延续下装线条，让整体更轻盈',
      _ => '克制的细节能建立造型重点，不破坏整体配色',
    };
    return '$shapeBenefit，适合偏${seed.style}的穿搭方向。';
  }

  static String _seasonFor(_ProductSeed seed) {
    final id = seed.id;
    if (id.contains('tee') || id.contains('airism') || id.contains('linen')) {
      return '春夏';
    }
    if (id.contains('wool') ||
        id.contains('down') ||
        id.contains('coat') ||
        id.contains('fleece')) {
      return '秋冬';
    }
    return '四季';
  }

  static String _fitTypeFor(_ProductSeed seed) {
    if (seed.category == ProductCategory.outerwear) {
      return seed.id.contains('cropped') || seed.id.contains('short')
          ? '短款廓形'
          : '强化肩线';
    }
    if (seed.category == ProductCategory.bottom) {
      return seed.id.contains('wide') || seed.id.contains('barrel')
          ? '高腰宽松'
          : '高腰直筒';
    }
    if (seed.category == ProductCategory.shoes) {
      return '轻量增高';
    }
    return seed.id.contains('relaxed') || seed.id.contains('wide')
        ? '宽松直身'
        : '合体直身';
  }

  static String _sizeFor(String category) {
    return category == ProductCategory.shoes ? '36-45' : 'S-XXL';
  }

  static String _materialFor(_ProductSeed seed) {
    final id = seed.id;
    if (id.contains('wool') || id.contains('knit')) {
      return '羊毛混纺';
    }
    if (id.contains('leather') ||
        id.contains('loafer') ||
        id.contains('derby')) {
      return '头层牛皮';
    }
    if (id.contains('airism') ||
        id.contains('dri-fit') ||
        id.contains('aeroready')) {
      return '功能纤维';
    }
    return seed.category == ProductCategory.shoes ? '织物/橡胶' : '精梳棉';
  }

  static double _commissionFor(String brand) {
    return switch (brand.toLowerCase()) {
      'uniqlo' => 0.08,
      '优衣库' => 0.08,
      'nike' => 0.07,
      'adidas' => 0.07,
      'zara' => 0.09,
      'cos' => 0.1,
      _ => 0.05,
    };
  }

  static String _purchaseUrlFor(_ProductSeed seed) {
    final brandHome = switch (seed.brand.toLowerCase()) {
      'uniqlo' || '优衣库' => 'https://www.uniqlo.cn/',
      'nike' => 'https://www.nike.com.cn/',
      'adidas' => 'https://www.adidas.com.cn/',
      'zara' => 'https://www.zara.cn/',
      'cos' => 'https://www.cos.com/',
      _ => 'https://example.com/',
    };
    final sku = Uri.encodeQueryComponent('FITAI-${seed.id.toUpperCase()}');
    final channel = Uri.encodeQueryComponent(affiliateChannelId);
    return '$brandHome?utm_source=fitai&utm_medium=affiliate'
        '&utm_campaign=commercial_v1&fitai_channel=$channel&fitai_sku=$sku';
  }

  static String _slotFor(String category) {
    if (category == ProductCategory.tee ||
        category == ProductCategory.shirt ||
        category == ProductCategory.top) {
      return ProductCategory.top;
    }
    return category;
  }
}

class _ProductSeed {
  const _ProductSeed(
    this.id,
    this.brand,
    this.name,
    this.category,
    this.price,
    this.style,
    this.color,
  );

  final String id;
  final String brand;
  final String name;
  final String category;
  final String price;
  final String style;
  final String color;
}
