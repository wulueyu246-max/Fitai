import 'dart:convert';

import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/models/product_analytics.dart';
import 'package:fit_ai/pages/affiliate_revenue_page.dart';
import 'package:fit_ai/services/affiliate_revenue_service.dart';
import 'package:fit_ai/services/affiliate_service.dart';
import 'package:fit_ai/services/analytics_service.dart';
import 'package:fit_ai/services/product_analytics_service.dart';
import 'package:fit_ai/services/purchase_launcher.dart';
import 'package:fit_ai/services/remote_brand_product_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test(
      'remote product source forwards affiliate channel without custom headers',
      () async {
    final client = MockClient((request) async {
      expect(request.headers['X-FitAI-Affiliate-Channel'], isNull);
      expect(request.headers['X-Shupi-Affiliate-Channel'], isNull);
      expect(
        request.url.queryParameters['affiliateChannelId'],
        'channel-commercial-test',
      );
      return http.Response.bytes(
        utf8.encode(jsonEncode({
          'products': [
            {
              'id': 'remote-shirt',
              'sku': 'REMOTE-SHIRT-001',
              'brand': 'Partner Brand',
              'name': '联盟白衬衫',
              'category': '衬衫',
              'image': 'https://cdn.example.com/shirt.jpg',
              'price': '399',
              'purchaseUrl':
                  'https://shop.example.com/items/REMOTE-SHIRT-001?aff=channel-commercial-test',
              'commission': 0.12,
            },
          ],
        })),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final service = RemoteBrandProductService(
      catalogEndpoint: Uri.parse('https://api.example.com/products'),
      affiliateChannelId: 'channel-commercial-test',
      client: client,
    );

    final products = await service.fetchProducts(brand: 'Partner Brand');

    expect(products, hasLength(1));
    expect(products.single.sku, 'REMOTE-SHIRT-001');
    expect(products.single.affiliateChannelId, 'channel-commercial-test');
    expect(products.single.sourceProvider, 'remote-affiliate-catalog');
    expect(
        products.single.purchaseUrl, contains('aff=channel-commercial-test'));
    expect(products.single.estimatedCommission, closeTo(47.88, 0.001));
  });

  test('remote product source parses the deployed mock response contract',
      () async {
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      return http.Response.bytes(
        utf8.encode(jsonEncode({
          'products': [
            {
              'product_id': 'tee-001',
              'source': 'mock',
              'title': 'AIRism 圆领T恤',
              'brand': 'Uniqlo',
              'category': 'T恤',
              'price': 99,
              'image_url': 'assets/images/products/structured_shirt.jpg',
              'purchase_url': '',
              'platform': 'mock-catalog',
              'commission_rate': 0,
              'stock_status': 'in_stock',
              'is_mock': true,
              'tags': ['极简', '通勤'],
            },
          ],
        })),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final service = RemoteBrandProductService(
      catalogEndpoint: Uri.parse('https://api.example.com/products/recommend'),
      client: client,
    );

    final products = await service.fetchProducts();

    expect(products, hasLength(1));
    expect(products.single.id, 'tee-001');
    expect(products.single.wardrobeSlot, ProductCategory.top);
    expect(products.single.isMock, isTrue);
    expect(products.single.styleTags, ['极简', '通勤']);
  });

  test('structured product requirements use a safe POST request', () async {
    final client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.queryParameters, isEmpty);
      expect(request.headers['Content-Type'], contains('application/json'));
      expect(request.headers['X-FitAI-Affiliate-Channel'], isNull);
      expect(request.headers['X-Shupi-Affiliate-Channel'], isNull);
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(body['gender'], 'male');
      expect(body['style'], 'clean fit');
      expect(body['scene'], 'date');
      final items = body['items'] as List<dynamic>;
      expect(items, hasLength(1));
      expect((items.single as Map<String, dynamic>)['category'], 'top');
      expect(
        (items.single as Map<String, dynamic>)['search_keywords'],
        ['男士 浅灰色 短袖 Polo', '男士 clean fit Polo 夏季'],
      );
      return http.Response(
        jsonEncode({
          'products': [
            {
              'product_id': 'taobao-polo-1',
              'source': 'taobao',
              'title': '男士浅灰色短袖Polo',
              'category': 'top',
              'price': 129,
              'image_url': 'https://img.example.com/polo.jpg',
              'purchase_url': 'https://s.click.taobao.com/polo',
              'platform': 'taobao',
              'is_mock': false,
              'gender': 'male',
              'search_keyword': '男士 浅灰色 短袖 Polo',
              'relevance_score': 90,
            },
          ],
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final service = RemoteBrandProductService(
      catalogEndpoint: Uri.parse('https://api.example.com/products/recommend'),
      client: client,
    );

    final products = await service.fetchProducts(
      recommendationContext: {
        'gender': 'male',
        'style': 'clean fit',
        'scene': 'date',
        'items': [
          {
            'category': 'top',
            'gender': 'male',
            'item_name': '浅灰色短袖Polo',
            'color': '浅灰色',
            'style': 'clean fit',
            'season': 'summer',
            'scene': 'date',
            'search_keywords': [
              '男士 浅灰色 短袖 Polo',
              '男士 clean fit Polo 夏季',
            ],
            'negative_keywords': ['女装', '吊带', '裙'],
          },
        ],
      },
    );

    expect(products, hasLength(1));
    expect(products.single.id, 'taobao-polo-1');
    expect(products.single.sourceProvider, 'taobao');
    expect(products.single.isMock, isFalse);
  });

  test('production safety binds real products to the current request',
      () async {
    const requestId = '123e4567-e89b-42d3-a456-426614174000';
    final client = MockClient((request) async {
      expect(request.headers['X-Request-Id'], requestId);
      return http.Response.bytes(
        utf8.encode(jsonEncode({
          'products': [
            {
              'product_id': 'current',
              'title': '男士白色长袖衬衫',
              'category': 'top',
              'price': 199,
              'image_url': '//img.alicdn.com/current.jpg',
              'purchase_url': 'https://s.click.taobao.com/current',
              'source': 'taobao',
              'is_mock': false,
              'request_id': requestId,
            },
            {
              'product_id': 'stale',
              'title': '上一轮商品',
              'category': 'top',
              'price': 99,
              'image_url': 'https://img.alicdn.com/stale.jpg',
              'purchase_url': 'https://s.click.taobao.com/stale',
              'source': 'taobao',
              'is_mock': false,
              'request_id': 'stale-request',
            },
          ],
        })),
        200,
      );
    });
    final service = RemoteBrandProductService(
      catalogEndpoint: Uri.parse('https://api.example.com/products/recommend'),
      client: client,
      enforceProductionSafety: true,
    );

    final products = await service.fetchProducts(
      recommendationContext: const {'request_id': requestId},
    );

    expect(products.map((product) => product.id), ['current']);
    expect(products.single.requestId, requestId);
  });

  test('production safety rejects Mock success payloads', () async {
    final client = MockClient((_) async => http.Response.bytes(
          utf8.encode(jsonEncode({
            'products': [
              {
                'product_id': 'mock-production',
                'title': 'Mock Studio 示例商品',
                'category': 'top',
                'price': 99,
                'image_url': 'https://img.example.com/mock.jpg',
                'source': 'mock',
                'is_mock': true,
              },
            ],
          })),
          200,
        ));
    final service = RemoteBrandProductService(
      catalogEndpoint: Uri.parse('https://api.example.com/products/recommend'),
      client: client,
      enforceProductionSafety: true,
    );

    await expectLater(
      service.fetchProducts(),
      throwsA(isA<ProductSourceException>()),
    );
  });

  test('remote product source accepts data.products and items wrappers',
      () async {
    var requestCount = 0;
    final client = MockClient((_) async {
      requestCount += 1;
      final productJson = {
        'product_id': 'pants-001',
        'title': '高腰直筒裤',
        'brand': 'Uniqlo',
        'category': '裤子',
        'price': 299,
        'image_url': 'assets/images/products/pleated_trousers.jpg',
        'purchase_url': '',
        'stock_status': 'in_stock',
        'is_mock': true,
      };
      return http.Response.bytes(
        utf8.encode(jsonEncode(
          requestCount == 1
              ? {
                  'data': {
                    'products': [productJson]
                  },
                }
              : {
                  'items': [productJson],
                },
        )),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final service = RemoteBrandProductService(
      catalogEndpoint: Uri.parse('https://api.example.com/products/recommend'),
      client: client,
    );

    expect(await service.fetchProducts(), hasLength(1));
    expect(await service.fetchProducts(), hasLength(1));
  });

  test('remote product source prioritizes categorySlots over products',
      () async {
    Map<String, dynamic> item(String id, String category) => {
          'product_id': id,
          'title': id,
          'brand': 'Shupi Select',
          'category': category,
          'price': 199,
          'image_url': 'assets/images/products/structured_shirt.jpg',
          'purchase_url': '',
          'stock_status': 'in_stock',
          'is_mock': true,
        };
    final client = MockClient((_) async {
      return http.Response.bytes(
        utf8.encode(
          jsonEncode({
            'products': [item('legacy-bottom', 'bottom')],
            'categorySlots': {
              'top': [item('slot-top', 'shirt')],
              'bottom': [item('slot-bottom', 'pants')],
              'shoes': [item('slot-shoes', 'sneakers')],
              'outerwear': [item('slot-outerwear', 'jacket')],
              'accessories': [item('slot-accessories', 'bag')],
            },
          }),
        ),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final service = RemoteBrandProductService(
      catalogEndpoint: Uri.parse('https://api.example.com/products/recommend'),
      client: client,
    );

    final products = await service.fetchProducts();

    expect(products, hasLength(5));
    expect(products.map((product) => product.wardrobeSlot).toList(), [
      ProductCategory.top,
      ProductCategory.bottom,
      ProductCategory.shoes,
      ProductCategory.outerwear,
      ProductCategory.accessories,
    ]);
    expect(products.any((product) => product.id == 'legacy-bottom'), isFalse);
  });

  test('affiliate purchase confirmation produces revenue summary', () async {
    final launcher = _FakePurchaseLauncher();
    final analytics = ProductAnalyticsService(
      analyticsService: LocalAnalyticsService(),
    );
    final affiliate = LocalAffiliateService(
      analytics: analytics,
      purchaseLauncher: launcher,
    );
    final product = MockProductDatabase.products.first;

    await affiliate.recordProductClick(
      product: product,
      source: 'launch-test',
    );
    await affiliate.openPurchase(
      product: product,
      source: 'launch-test',
    );
    final completed = await affiliate.confirmPurchase(
      product: product,
      orderId: 'ORDER-V1-001',
      source: 'affiliate-postback',
    );
    final summary = await AffiliateRevenueService(
      analytics: analytics,
    ).load();

    expect(completed.action, ProductAnalyticsAction.purchaseCompleted);
    expect(completed.orderId, 'ORDER-V1-001');
    expect(completed.affiliateChannelId, product.affiliateChannelId);
    expect(summary.purchaseRedirects, greaterThanOrEqualTo(1));
    expect(summary.confirmedOrders, greaterThanOrEqualTo(1));
    expect(
      summary.confirmedCommission,
      greaterThanOrEqualTo(product.estimatedCommission),
    );
    expect(summary.channelIds, contains(product.affiliateChannelId));
  });

  testWidgets('affiliate revenue page exposes commercial metrics',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: AffiliateRevenuePage(
          service: AffiliateRevenueService(
            analytics: ProductAnalyticsService(
              analyticsService: LocalAnalyticsService(),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('联盟收益'), findsOneWidget);
    expect(find.text('已确认联盟佣金'), findsOneWidget);
    expect(find.text('商品曝光'), findsOneWidget);
    expect(find.text('购买跳转'), findsOneWidget);
    expect(find.byKey(const Key('refresh-affiliate-revenue')), findsOneWidget);
  });
}

class _FakePurchaseLauncher implements PurchaseLauncher {
  @override
  Future<void> open(Product product) async {}
}
