import 'dart:convert';

import 'package:fit_ai/config/app_config.dart';
import 'package:fit_ai/models/outfit_request.dart';
import 'package:fit_ai/services/ai_service.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  const request = OutfitRequest(
    height: 170,
    weight: 60,
    scene: '日常',
    request: '通勤穿搭',
    images: {
      'front': 'data:image/jpeg;base64,AA==',
    },
  );

  test('sends OutfitRequest and parses top-level OutfitAnalysis', () async {
    final client = MockClient((http.Request httpRequest) async {
      expect(httpRequest.url.toString(), 'https://api.example.com/outfit');
      expect(httpRequest.headers['Accept'], 'application/json');
      expect(
        httpRequest.headers['Content-Type'],
        'application/json; charset=utf-8',
      );

      final body = jsonDecode(httpRequest.body) as Map<String, dynamic>;
      expect(body['height'], 170);
      expect(body['weight'], 60);
      expect(body['scene'], '日常');
      expect((body['images'] as Map)['front'], startsWith('data:image/jpeg'));

      return http.Response(
        jsonEncode({
          'bodyProfile': '身体分析',
          'style': '风格',
          'recommendations': {
            'top': '上衣',
            'bottom': '下装',
            'shoes': '鞋子',
            'accessories': '配饰',
            'summary': '总结',
            'products': [
              {
                'title': '结构感短款外套',
                'brand': 'Shupi Select',
                'product_id': 'catalog-product-1',
                'category': '上衣',
                'color': '深灰',
                'size': 'S-XL',
                'keyword': '短款外套',
                'price': 399,
                'image_url': 'https://cdn.example.com/product-1.jpg',
                'detail_url': 'https://shop.example.com/product-1',
                'platform': 'mock-catalog',
                'commission_rate': 0.08,
                'affiliate_url':
                    'https://shop.example.com/product-1?channel=test',
                'stock_status': 'in_stock',
              },
            ],
          },
          'products': [
            {
              'category': '上衣',
              'name': '短款外套',
              'color': '深灰',
              'material': '棉混纺',
              'reason': '优化比例',
            },
          ],
          'analysisMode': 'ai',
        }),
        200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': 'request-1',
        },
      );
    });
    final service = AIService(
      client: client,
      config: const AppConfig(apiBaseUrl: 'https://api.example.com'),
    );

    final analysis = await service.generateOutfit(request);

    expect(analysis.bodyAnalysis, '身体分析');
    expect(analysis.suggestion, '总结');
    expect(analysis.recommendedProducts, hasLength(1));
    expect(analysis.recommendedProducts.single.name, '结构感短款外套');
    expect(
      analysis.recommendedProducts.single.sourceProvider,
      'mock-catalog',
    );
    expect(analysis.productRecommendations, hasLength(1));
    expect(
      analysis.productRecommendations.single.id,
      'catalog-product-1',
    );
    expect(analysis.productRecommendations.single.price, 399);
    expect(analysis.productRecommendations.single.commissionRate, 0.08);
  });

  test('normalizes the request fields before sending JSON', () async {
    const unnormalizedRequest = OutfitRequest(
      height: 173,
      weight: 55,
      scene: ' 工作 ',
      request: ' 生成通勤穿搭 ',
      images: {
        'front': ' data:image/jpeg;base64,AA== ',
        'side': '',
        'back': '   ',
        'unknown': 'data:image/jpeg;base64,AA==',
      },
    );
    expect(unnormalizedRequest.toJson(), {
      'height': 173,
      'weight': 55,
      'scene': '工作',
      'request': '生成通勤穿搭',
      'images': {
        'front': 'data:image/jpeg;base64,AA==',
      },
    });

    final client = MockClient((_) async {
      return http.Response(
        jsonEncode({
          'bodyProfile': '身体分析',
          'style': '风格',
          'recommendations': {
            'top': '上衣',
            'bottom': '下装',
            'shoes': '鞋子',
            'accessories': '配饰',
            'summary': '总结',
          },
          'products': [
            {
              'category': '上衣',
              'name': '短款外套',
              'color': '深灰',
              'material': '棉混纺',
              'reason': '优化比例',
            },
          ],
        }),
        200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      );
    });
    final service = AIService(
      client: client,
      config: const AppConfig(apiBaseUrl: 'https://api.example.com'),
    );

    await service.generateOutfit(unnormalizedRequest);
  });

  test('uses the Render backend by default on Android', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    try {
      expect(
        AppConfig.fromEnvironment().outfitEndpoint.toString(),
        'https://fitai-jqtl.onrender.com/outfit',
      );
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  test('rewrites configured loopback URLs only for Android', () {
    expect(
      AppConfig.resolveApiBaseUrl(
        'http://127.0.0.1:3000',
        platform: TargetPlatform.android,
        isWeb: false,
      ),
      'http://10.0.2.2:3000',
    );
    expect(
      AppConfig.resolveApiBaseUrl(
        'http://localhost:3000',
        platform: TargetPlatform.android,
        isWeb: false,
      ),
      'http://10.0.2.2:3000',
    );
    expect(
      AppConfig.resolveApiBaseUrl(
        'http://127.0.0.1:3000',
        platform: TargetPlatform.windows,
        isWeb: false,
      ),
      'http://127.0.0.1:3000',
    );
    expect(
      AppConfig.resolveApiBaseUrl(
        'http://127.0.0.1:3000',
        platform: TargetPlatform.android,
        isWeb: true,
      ),
      'http://127.0.0.1:3000',
    );
  });

  test('maps structured server errors to AIServiceException', () async {
    final client = MockClient((_) async {
      return http.Response(
        jsonEncode({
          'error': {
            'code': 'RATE_LIMITED',
            'message': '请求过于频繁',
            'request_id': 'request-2',
          },
        }),
        429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      );
    });
    final service = AIService(
      client: client,
      config: const AppConfig(apiBaseUrl: 'https://api.example.com'),
    );

    await expectLater(
      service.generateOutfit(request),
      throwsA(
        isA<AIServiceException>()
            .having((error) => error.statusCode, 'statusCode', 429)
            .having((error) => error.requestId, 'requestId', 'request-2')
            .having((error) => error.message, 'message', '请求过于频繁'),
      ),
    );
  });

  test('parses wrapped snake-case compatible analysis response', () async {
    final client = MockClient((_) async {
      return http.Response(
        jsonEncode({
          'result': jsonEncode({
            'body_profile': 'balanced proportions',
            'style': 'minimal commute',
            'recommendations': {
              'top_recommendation': 'structured top',
              'bottom_recommendation': 'straight trousers',
              'shoe_recommendation': 'low shoes',
              'accessory_recommendation': 'watch',
              'suggestion': 'keep the silhouette clean',
            },
            'analysis_mode': 'ai',
          }),
        }),
        200,
      );
    });
    final service = AIService(
      client: client,
      config: const AppConfig(apiBaseUrl: 'https://api.example.com'),
    );

    final analysis = await service.generateOutfit(request);

    expect(analysis.bodyAnalysis, 'balanced proportions');
    expect(analysis.top, 'structured top');
    expect(analysis.suggestion, 'keep the silhouette clean');
  });
}
