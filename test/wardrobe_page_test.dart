import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/models/ai_recommendation_record.dart';
import 'package:fit_ai/models/outfit_plan.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/models/try_on_record.dart';
import 'package:fit_ai/models/wardrobe_snapshot.dart';
import 'package:fit_ai/pages/wardrobe_page.dart';
import 'package:fit_ai/repositories/wardrobe_repository.dart';
import 'package:fit_ai/services/recommendation_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('wardrobe shows favorites, plans and try-on history', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final products = MockProductDatabase.products.take(12).toList();
    final plan = const RecommendationService().buildOutfitPlan(
      products: products,
      style: '极简',
      scene: '通勤',
      createdTime: DateTime(2026, 7, 30),
    );
    final repository = _FakeWardrobeRepository(
      WardrobeSnapshot(
        favoriteProducts: [products.first],
        outfitPlans: [plan],
        tryOnHistory: [
          TryOnRecord(
            id: 'history-1',
            userId: 'user-1',
            imageUrl: 'assets/images/home/business_commute.jpg',
            outfitPlan: plan,
            createdTime: DateTime(2026, 7, 30),
            isMock: true,
          ),
        ],
        aiRecommendationHistory: [
          AIRecommendationRecord(
            id: 'ai-history-1',
            scene: '通勤',
            bodyAnalysis: '肩部线条偏窄，整体比例均衡',
            style: '极简通勤',
            outfitPlan: plan,
            createdTime: DateTime(2026, 7, 30),
          ),
        ],
      ),
    );

    await tester.pumpWidget(
      MaterialApp(home: WardrobePage(repository: repository)),
    );
    await tester.pumpAndSettle();

    expect(find.text('我的衣柜'), findsOneWidget);
    expect(find.text(products.first.name), findsOneWidget);

    await tester.tap(find.text('我的穿搭'));
    await tester.pumpAndSettle();
    expect(find.text(plan.title), findsOneWidget);

    await tester.tap(find.text('试穿记录'));
    await tester.pumpAndSettle();
    expect(find.text('2026.7.30'), findsOneWidget);

    await tester.tap(find.text('AI建议'));
    await tester.pumpAndSettle();
    expect(find.text('通勤 · 极简通勤'), findsOneWidget);
  });
}

class _FakeWardrobeRepository extends ChangeNotifier
    implements WardrobeRepository {
  _FakeWardrobeRepository(this.snapshot);

  WardrobeSnapshot snapshot;

  @override
  Listenable get changes => this;

  @override
  Future<WardrobeSnapshot> load() async => snapshot;

  @override
  Future<void> saveTryOnRecord(TryOnRecord record) async {}

  @override
  Future<void> saveAIRecommendation(AIRecommendationRecord record) async {}

  @override
  Future<bool> toggleOutfitPlan(OutfitPlan plan) async => false;

  @override
  Future<bool> toggleProduct(Product product) async => false;
}
