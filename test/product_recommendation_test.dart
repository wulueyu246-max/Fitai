import 'package:fit_ai/models/product_recommendation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('serializes a catalog-backed product recommendation', () {
    final recommendation = ProductRecommendation.fromJson({
      'product_id': 'product-1',
      'title': '结构感短款外套',
      'brand': 'Shupi Select',
      'category': '外套',
      'color': '深灰',
      'size': 'S-XL',
      'keyword': '短款通勤外套',
      'price': '399',
      'image_url': 'https://cdn.example.com/product-1.jpg',
      'detail_url': 'https://shop.example.com/product-1',
      'platform': 'taobao',
      'commission_rate': 0.08,
      'affiliate_url': 'https://shop.example.com/product-1?channel=test',
      'stock_status': 'in_stock',
      'is_mock': false,
      'original_price': 499,
      'coupon_amount': 20,
      'shop_name': '测试店铺',
      'recommendation_reason': '根据通勤场景推荐',
      'match_explanation': '匹配短款外套需求',
    });

    expect(recommendation.price, 399);
    expect(recommendation.commissionRate, 0.08);
    expect(recommendation.isPurchasable, isTrue);
    expect(recommendation.toJson()['product_id'], 'product-1');
    expect(
      recommendation.toJson().keys.toSet(),
      {
        'product_id',
        'title',
        'brand',
        'category',
        'price',
        'image_url',
        'detail_url',
        'platform',
        'commission_rate',
        'affiliate_url',
        'stock_status',
        'original_price',
        'coupon_amount',
        'shop_name',
        'sales',
        'recommendation_reason',
        'match_explanation',
        'is_mock',
      },
    );
    expect(recommendation.toProduct().name, '结构感短款外套');
    expect(recommendation.toProduct().sourceProvider, 'taobao');
  });

  test('rejects negative prices and incomplete products', () {
    expect(
      () => ProductRecommendation.fromJson({
        'product_id': 'product-1',
        'category': '外套',
        'keyword': '短款外套',
        'title': '结构感短款外套',
        'image_url': 'https://cdn.example.com/product-1.jpg',
        'price': -1,
        'platform': 'mock-catalog',
        'commission_rate': 0,
        'detail_url': 'https://shop.example.com/product-1',
        'affiliate_url': 'https://shop.example.com/product-1',
        'stock_status': 'in_stock',
      }),
      throwsFormatException,
    );
  });
}
