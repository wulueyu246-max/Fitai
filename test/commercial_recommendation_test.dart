import 'package:fit_ai/data/mock_outfit_post_database.dart';
import 'package:fit_ai/models/outfit_post.dart';
import 'package:fit_ai/models/user_preference.dart';
import 'package:fit_ai/services/brand_service.dart';
import 'package:fit_ai/services/recommendation_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('OutfitPost supports community serialization with products', () {
    final post = MockOutfitPostDatabase.posts.first;
    final restored = OutfitPost.fromJson(post.toJson());

    expect(restored.id, post.id);
    expect(restored.user, isNotEmpty);
    expect(restored.products, isNotEmpty);
    expect(restored.likes, greaterThan(0));
    expect(restored.comments, greaterThan(0));
    expect(restored.saves, greaterThan(0));
    expect(restored.authorId, isNotEmpty);
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
      posts: MockOutfitPostDatabase.posts,
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
