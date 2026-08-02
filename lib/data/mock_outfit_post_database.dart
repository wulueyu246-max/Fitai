import '../models/outfit_post.dart';
import '../models/product.dart';
import 'mock_product_database.dart';

abstract final class MockOutfitPostDatabase {
  static final List<OutfitPost> posts = List<OutfitPost>.unmodifiable([
    _post(
      id: 'commute-proportion',
      user: '树皮造型师',
      image: 'assets/images/home/business_commute.jpg',
      title: '173cm身材比例优化方案',
      description: '通勤场景用短外套、高腰直筒裤建立纵向线条，肩部轮廓更清晰。',
      productIds: [
        'uniqlo-tailored-blazer',
        'uniqlo-smart-pants',
        'cos-leather-derby',
      ],
      likes: 12840,
      dayOffset: 0,
    ),
    _post(
      id: 'date-soft-light',
      user: 'Mia的衣橱',
      image: 'assets/images/home/date_night.jpg',
      title: '约会第一印象的柔和层次',
      description: '约会场景降低配色对比，把视觉注意力自然引向面部。',
      productIds: [
        'zara-date-shirt',
        'zara-relaxed-pants',
        'zara-minimal-sneaker',
      ],
      likes: 9632,
      dayOffset: 1,
    ),
    _post(
      id: 'travel-light',
      user: '城市漫游计划',
      image: 'assets/images/home/summer_clean.jpg',
      title: '旅行轻装也能保持高级感',
      description: '旅行场景选择透气上衣、宽松裤型和轻量鞋履，适合长时间步行。',
      productIds: [
        'uniqlo-airism-tee',
        'uniqlo-wide-chino',
        'nike-cortez',
      ],
      likes: 8470,
      dayOffset: 2,
    ),
    _post(
      id: 'sport-city',
      user: 'MoveLab',
      image: 'assets/images/home/street_graphite.jpg',
      title: '运动与城市通勤的混搭公式',
      description: '运动场景采用功能面料与克制配色，训练结束后也能直接进入城市生活。',
      productIds: [
        'nike-dri-fit-tee',
        'adidas-straight-pants',
        'nike-air-max',
      ],
      likes: 7920,
      dayOffset: 3,
    ),
    _post(
      id: 'formal-monochrome',
      user: 'Noir Studio',
      image: 'assets/images/home/minimal_monochrome.jpg',
      title: '正式场合黑灰同色系不沉闷',
      description: '正式场合通过羊毛、棉和皮革的材质差建立层次，克制但有存在感。',
      productIds: [
        'cos-short-wool-jacket',
        'cos-tapered-trousers',
        'cos-leather-derby',
      ],
      likes: 6841,
      dayOffset: 4,
    ),
    _post(
      id: 'interview-confidence',
      user: '树皮职场造型师',
      image: 'assets/images/home/business_commute.jpg',
      title: '面试第一印象的可信穿搭',
      description: '面试场景用清晰肩线、低饱和配色和干净鞋型，建立专业且不刻板的第一印象。',
      productIds: [
        'uniqlo-tailored-blazer',
        'cos-tapered-trousers',
        'cos-leather-derby',
      ],
      likes: 7568,
      dayOffset: 5,
    ),
    _post(
      id: 'weekend-korean',
      user: 'Yuki穿搭研究所',
      image: 'assets/images/home/korean_soft.jpg',
      title: '周末松弛感的轻盈比例',
      description: '约会与轻社交都适用的低饱和组合，柔软廓形能提升亲和力。',
      productIds: [
        'cos-clean-tee',
        'zara-wide-trousers',
        'adidas-gazelle',
      ],
      likes: 10260,
      dayOffset: 6,
    ),
  ]);

  static OutfitPost _post({
    required String id,
    required String user,
    required String image,
    required String title,
    required String description,
    required List<String> productIds,
    required int likes,
    required int dayOffset,
  }) {
    return OutfitPost(
      id: id,
      user: user,
      authorId: 'author-${user.hashCode.abs()}',
      image: image,
      title: title,
      description: description,
      products: productIds.map(_product).toList(growable: false),
      likes: likes,
      comments: (likes / 38).round(),
      saves: (likes / 12).round(),
      createdAt: DateTime(2026, 7, 30).subtract(Duration(days: dayOffset)),
    );
  }

  static Product _product(String id) {
    return MockProductDatabase.findById(id) ??
        (throw StateError('Mock OutfitPost 商品不存在：$id'));
  }
}
