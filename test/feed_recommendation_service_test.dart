import 'package:fit_ai/features/home/models/daily_fashion_context.dart';
import 'package:fit_ai/features/home/models/fashion_feed.dart';
import 'package:fit_ai/features/home/services/feed_recommendation_service.dart';
import 'package:fit_ai/models/fashion_profile.dart';
import 'package:fit_ai/models/user_profile.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const profile = UserProfile(
    height: 173,
    weight: 55,
    bodyType: '偏瘦、肩窄',
    stylePreference: ['极简', '通勤'],
    favoriteColors: ['白色', '黑色'],
    favoriteBrands: ['COS', 'Uniqlo'],
    purchaseHistory: [],
    tryOnHistory: [],
  );
  const fashionProfile = FashionProfile(
    likedStyles: ['极简', '通勤'],
    likedBrands: ['COS', 'Uniqlo'],
    budgetMin: 100,
    budgetMax: 1000,
    commonColors: ['白色', '黑色'],
    bodyFeatures: ['偏瘦', '肩窄'],
    purchaseHistory: [],
  );

  test('builds daily AI Fashion Feed from profile, weather and behavior', () {
    final feed = const FeedRecommendationService().recommend(
      FeedRecommendationInput(
        userProfile: profile,
        fashionProfile: fashionProfile,
        aiBodyAnalysis: '肩部线条偏窄，腿长比例均衡',
        browsingRecords: const ['commute-proportion'],
        favoriteProductIds: const {'cos-clean-tee'},
        tryOnProductIds: const ['uniqlo-smart-pants'],
        feedback: const [],
        context: DailyFashionContext(
          temperature: 25,
          condition: '多云',
          city: '上海',
          updatedAt: DateTime(2026, 7, 30),
        ),
        challenge: const OutfitChallenge(
          id: 'seven-day-look',
          title: '7天AI穿搭挑战',
          description: '每天生成一个新 Look',
          totalDays: 7,
          completedDays: 2,
          checkedInToday: false,
        ),
        scene: '通勤',
      ),
    );

    expect(feed.dailyReason, contains('25℃'));
    expect(feed.dailyPlan.products, hasLength(3));
    expect(feed.hotLooks, isEmpty);
    expect(feed.communityLooks, isEmpty);
    expect(feed.products, hasLength(10));
    expect(
      fashionProfile.isWithinBudget(feed.products.first.price),
      isTrue,
    );
    expect(
      feed.scenes.map((scene) => scene.title),
      containsAll(['通勤', '约会', '旅行', '运动', '面试']),
    );
    expect(feed.challenge.completedDays, 2);
  });

  test('changes weather styling advice for hot days', () {
    final feed = const FeedRecommendationService().recommend(
      FeedRecommendationInput(
        userProfile: profile,
        fashionProfile: fashionProfile,
        aiBodyAnalysis: '肩部线条偏窄',
        browsingRecords: const [],
        favoriteProductIds: const {},
        tryOnProductIds: const [],
        feedback: const [],
        context: DailyFashionContext(
          temperature: 33,
          condition: '晴',
          city: '广州',
          updatedAt: DateTime(2026, 7, 30),
        ),
        challenge: const OutfitChallenge(
          id: 'seven-day-look',
          title: '7天AI穿搭挑战',
          description: '',
          totalDays: 7,
          completedDays: 0,
          checkedInToday: false,
        ),
        scene: '旅行',
      ),
    );

    expect(feed.dailyReason, contains('透气面料'));
  });
}
