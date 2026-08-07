import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/models/outfit_post.dart';
import 'package:fit_ai/models/user_preference.dart';
import 'package:fit_ai/services/brand_service.dart';
import 'package:fit_ai/services/recommendation_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('OutfitPost supports community serialization with products', () {
    final post = _testPost;
    final restored = OutfitPost.fromJson(post.toJson());

    expect(restored.id, post.id);
    expect(restored.user, isNotEmpty);
    expect(restored.products, isNotEmpty);
    expect(restored.likes, greaterThan(0));
    expect(restored.comments, greaterThan(0));
    expect(restored.saves, greaterThan(0));
    expect(restored.authorId, isNotEmpty);
    expect(restored.requestId, 'test-look-request');
    expect(restored.gender, 'unisex');
  });

  test('user preferences affect the community recommendation channel', () {
    const preference = UserPreference(
      likedStyles: ['休闲', '极简'],
      likedColors: ['米白', '黑色'],
      bodyFeatures: ['肩部偏窄'],
      purchaseHistory: [],
      browsingHistory: [],
    );
    final restored = UserPreference.fromJson(preference.toJson());
    final posts = const RecommendationService().recommendPosts(
      posts: [_testPost],
      preference: restored,
      channel: '旅行',
    );

    expect(posts, isNotEmpty);
    expect('${posts.first.title}${posts.first.description}', contains('旅行'));
  });

  test('brand service exposes future catalog synchronization boundary',
      () async {
    const service = MockBrandService(delay: Duration.zero);
    final brands = await service.getBrands();
    final products = await service.getBrandProducts('uniqlo');

    expect(
      brands.map((brand) => brand.name),
      containsAll(['UNIQLO', 'Nike', 'Adidas', 'ZARA', 'COS']),
    );
    expect(products, isNotEmpty);
    expect(products.every((product) => product.sku.isNotEmpty), isTrue);
    await service.synchronizeCatalog('uniqlo');
  });
}

final _testPost = OutfitPost(
  id: 'test-travel-look',
  user: '测试用户',
  authorId: 'test-author',
  image: 'assets/images/home/summer_clean.jpg',
  imageSource: 'test',
  requestId: 'test-look-request',
  gender: 'unisex',
  style: '极简',
  scene: '旅行',
  title: '旅行轻装方案',
  description: '旅行场景的轻量组合',
  products: MockProductDatabase.products.take(3).toList(growable: false),
  likes: 10,
  comments: 2,
  saves: 3,
  createdAt: DateTime(2026, 7, 30),
);
