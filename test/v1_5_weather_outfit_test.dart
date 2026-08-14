import 'package:fit_ai/components/product_card.dart';
import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/models/app_location.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/models/weather_snapshot.dart';
import 'package:fit_ai/services/weather_outfit_advisor.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const advisor = WeatherOutfitAdvisor();
  final location = AppLocation(
    country: '中国',
    city: '上海',
    latitude: 31.23,
    longitude: 121.47,
    source: 'manual',
    updatedAt: DateTime(2026),
  );

  test('rain creates an explicit waterproof AI rule and product reason', () {
    final weather = WeatherSnapshot(
      city: '上海',
      country: '中国',
      temperature: 19,
      condition: '有雨',
      humidity: 88,
      windSpeed: 16,
      high: 21,
      low: 17,
      weatherCode: 61,
      updatedAt: DateTime(2026),
    );

    final prompt = advisor.buildPrompt(
      weather: weather,
      scene: '工作',
      location: location,
    );
    final products = advisor.adaptProducts(
      products: MockProductDatabase.products.take(30).toList(),
      weather: weather,
      scene: '工作',
    );
    expect(prompt, contains('用户地区：中国 上海'));
    expect(prompt, contains('防泼水外套'));
    expect(prompt, contains('场景：工作'));
    expect(
      products.take(5).any(
            (product) =>
                product.wardrobeSlot == ProductCategory.outerwear ||
                product.wardrobeSlot == ProductCategory.shoes,
          ),
      isTrue,
    );
    expect(products.first.aiReason, contains('适合工作场景'));
  });

  test('hot and humid weather prioritizes breathable short sleeves', () {
    final weather = WeatherSnapshot(
      city: '广州',
      country: '中国',
      temperature: 33,
      condition: '晴朗',
      humidity: 82,
      windSpeed: 7,
      high: 36,
      low: 27,
      weatherCode: 0,
      updatedAt: DateTime(2026),
    );

    final products = advisor.adaptProducts(
      products: MockProductDatabase.products,
      weather: weather,
      scene: '日常',
    );

    expect(products.first.wardrobeSlot, ProductCategory.top);
    expect(products.first.aiReason, contains('轻薄、透气'));
    expect(
      advisor.buildPrompt(weather: weather, scene: '日常'),
      contains('高温时优先短袖'),
    );
    expect(advisor.constraintsFor(weather), contains('高温时优先短袖、透气或速干材质，减少厚重层次'));
    expect(advisor.constraintsFor(weather), contains('高湿度时避免闷热面料，优先透气和速干单品'));
  });

  testWidgets('unfinished try-on entry stays hidden on product cards', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 360,
              child: ProductCard(
                product: MockProductDatabase.products.first,
                selected: false,
                onViewDetails: () {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('立即试穿'), findsNothing);
    expect(find.text('查看详情'), findsOneWidget);
  });
}
