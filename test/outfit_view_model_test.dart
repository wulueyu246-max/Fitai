import 'dart:async';

import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:fit_ai/models/outfit_request.dart';
import 'package:fit_ai/models/outfit_plan.dart';
import 'package:fit_ai/models/product_search_requirement.dart';
import 'package:fit_ai/models/product_loading_state.dart';
import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/repositories/outfit_repository.dart';
import 'package:fit_ai/services/ai_service.dart';
import 'package:fit_ai/view_models/outfit_view_model.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const request = OutfitRequest(
    height: 170,
    weight: 60,
    scene: '日常',
    request: '',
    images: {
      'front': 'data:image/jpeg;base64,AA==',
    },
  );

  test('publishes a successful analysis', () async {
    final repository = _FakeOutfitRepository();
    final viewModel = OutfitViewModel(repository: repository);

    final succeeded = await viewModel.generateOutfit(request);

    expect(succeeded, isTrue);
    expect(viewModel.isLoading, isFalse);
    expect(viewModel.analysis?.style, '极简');
    expect(viewModel.errorMessage, isNull);

    viewModel.dispose();
    expect(repository.closed, isTrue);
  });

  test('publishes a safe error and request id', () async {
    final repository = _FakeOutfitRepository(
      error: const AIServiceException(
        '服务繁忙',
        statusCode: 503,
        requestId: 'request-3',
      ),
    );
    final viewModel = OutfitViewModel(repository: repository);

    final succeeded = await viewModel.generateOutfit(request);

    expect(succeeded, isFalse);
    expect(viewModel.isLoading, isFalse);
    expect(viewModel.errorMessage, '服务繁忙');
    expect(viewModel.requestId, 'request-3');

    viewModel.dispose();
  });

  test('keeps safe AI product suggestions until catalog matching', () async {
    final repository = _FakeOutfitRepository(
      response: OutfitAnalysis(
        bodyAnalysis: '身体分析',
        style: '极简',
        top: '上衣建议',
        bottom: '下装建议',
        shoes: '鞋履建议',
        accessories: '配饰建议',
        suggestion: '总结',
        recommendedProducts: [MockProductDatabase.products.first],
      ),
    );
    final viewModel = OutfitViewModel(repository: repository);

    expect(await viewModel.generateOutfit(request), isTrue);
    expect(viewModel.analysis?.recommendedProducts, isEmpty);
    expect(viewModel.analysis?.outfitPlan, isNull);
  });

  test('preserves male AI gender and structured search requirements', () async {
    const requirement = ProductSearchRequirement(
      category: 'top',
      gender: 'male',
      itemName: '法式长袖衬衫',
      color: '白色',
      style: '法式',
      season: 'spring',
      scene: 'date',
      searchKeywords: ['男士 法式衬衫', '男士 法式 长袖衬衫', '男士 法式 上衣'],
      negativeKeywords: ['女', '女士', '吊带'],
    );
    final viewModel = OutfitViewModel(
      repository: _FakeOutfitRepository(
        response: const OutfitAnalysis(
          bodyAnalysis: '男性体型分析',
          style: '法式',
          top: '法式衬衫',
          bottom: '休闲裤',
          shoes: '男士皮鞋',
          accessories: '腕表',
          suggestion: '男性约会穿搭',
          gender: 'male',
          requestId: 'request-male-1',
          productRequirements: [requirement],
        ),
      ),
    );

    expect(await viewModel.generateOutfit(request), isTrue);
    expect(viewModel.analysis?.gender, 'male');
    expect(viewModel.analysis?.productRequirements.single.gender, 'male');
    expect(
      viewModel.analysis?.productRequirements.single.searchKeywords.first,
      startsWith('男士'),
    );
    expect(viewModel.requestId, 'request-male-1');
  });

  test('allows only one generate request at a time', () async {
    final gate = Completer<void>();
    final repository = _FakeOutfitRepository(gate: gate);
    final viewModel = OutfitViewModel(repository: repository);

    final firstRequest = viewModel.generateOutfit(request);
    await Future<void>.delayed(Duration.zero);
    final duplicateResult = await viewModel.generateOutfit(request);

    expect(duplicateResult, isFalse);
    expect(repository.generateCalls, 1);

    gate.complete();
    expect(await firstRequest, isTrue);
    expect(repository.generateCalls, 1);
    viewModel.dispose();
  });

  test(
      'product failure preserves the current outfit and supports product-only retry state',
      () async {
    final viewModel = OutfitViewModel(
      repository: _FakeOutfitRepository(
        response: const OutfitAnalysis(
          bodyAnalysis: '身体分析',
          style: '轻熟',
          top: '上衣',
          bottom: '下装',
          shoes: '鞋履',
          accessories: '配饰',
          suggestion: '总结',
          gender: 'female',
          requestId: 'request-stable-1',
        ),
      ),
    );

    expect(await viewModel.generateOutfit(request), isTrue);
    final preserved = viewModel.analysis;
    expect(viewModel.beginProductLoading('request-stable-1'), isTrue);
    expect(viewModel.productState, ProductLoadingState.loading);
    expect(
      viewModel.markProductFailure('request-stable-1', timeout: true),
      isTrue,
    );
    expect(viewModel.productState, ProductLoadingState.timeout);
    expect(viewModel.productErrorMessage, contains('重新匹配商品'));
    expect(viewModel.analysis, same(preserved));

    expect(viewModel.beginProductLoading('request-stable-1'), isTrue);
    expect(viewModel.productState, ProductLoadingState.loading);
    expect(viewModel.analysis, same(preserved));
    viewModel.dispose();
  });

  test('real products remain visible when AI rerank uses rule fallback',
      () async {
    final viewModel = OutfitViewModel(
      repository: _FakeOutfitRepository(
        response: const OutfitAnalysis(
          bodyAnalysis: '身体分析',
          style: '轻熟',
          top: '上衣',
          bottom: '下装',
          shoes: '鞋履',
          accessories: '配饰',
          suggestion: '总结',
          gender: 'female',
          requestId: 'request-fallback-1',
        ),
      ),
    );
    expect(await viewModel.generateOutfit(request), isTrue);
    final fallbackProduct = MockProductDatabase.products.first.copyWith(
      requestId: 'request-fallback-1',
      sourceProvider: 'taobao',
      isMock: false,
      aiRerankFallback: true,
    );

    expect(
      viewModel.attachRecommendations(
        [fallbackProduct],
        expectedRequestId: 'request-fallback-1',
        expectedGender: 'female',
      ),
      isTrue,
    );
    expect(viewModel.productState, ProductLoadingState.fallback);
    expect(viewModel.analysis?.recommendedProducts, [fallbackProduct]);
    expect(viewModel.productErrorMessage, isNull);
    viewModel.dispose();
  });

  for (final gender in const ['male', 'female']) {
    test('$gender Look only attaches to the current request and gender',
        () async {
      final currentRequestId = 'request-$gender-current';
      final response = OutfitAnalysis(
        bodyAnalysis: '身体分析',
        style: '极简',
        top: '上衣',
        bottom: '下装',
        shoes: '鞋履',
        accessories: '配饰',
        suggestion: '总结',
        gender: gender,
        requestId: currentRequestId,
      );
      final viewModel = OutfitViewModel(
        repository: _FakeOutfitRepository(response: response),
      );
      expect(await viewModel.generateOutfit(request), isTrue);

      final products = [
        MockProductDatabase.products.firstWhere(
          (product) => product.wardrobeSlot == 'top',
        ),
        MockProductDatabase.products.firstWhere(
          (product) => product.wardrobeSlot == 'bottom',
        ),
        MockProductDatabase.products.firstWhere(
          (product) => product.wardrobeSlot == 'shoes',
        ),
      ];
      OutfitPlan plan({required String requestId, required String gender}) {
        return OutfitPlan(
          id: 'plan-$requestId',
          title: '当前 Look',
          top: products[0],
          bottom: products[1],
          shoes: products[2],
          reason: '测试',
          createdTime: DateTime(2026, 8, 7),
          requestId: requestId,
          gender: gender,
          style: '极简',
          scene: '日常',
        );
      }

      expect(
        viewModel.attachRecommendations(
          products,
          outfitPlan: plan(
            requestId: 'request-stale',
            gender: gender,
          ),
          expectedRequestId: currentRequestId,
          expectedGender: gender,
        ),
        isFalse,
      );
      expect(viewModel.analysis?.outfitPlan, isNull);

      final oppositeGender = gender == 'male' ? 'female' : 'male';
      expect(
        viewModel.attachRecommendations(
          products,
          outfitPlan: plan(
            requestId: currentRequestId,
            gender: oppositeGender,
          ),
          expectedRequestId: currentRequestId,
          expectedGender: gender,
        ),
        isFalse,
      );
      expect(viewModel.analysis?.outfitPlan, isNull);

      expect(
        viewModel.attachRecommendations(
          products,
          outfitPlan: plan(
            requestId: currentRequestId,
            gender: gender,
          ),
          expectedRequestId: currentRequestId,
          expectedGender: gender,
        ),
        isTrue,
      );
      expect(viewModel.analysis?.outfitPlan?.gender, gender);
      expect(viewModel.analysis?.outfitPlan?.requestId, currentRequestId);
      viewModel.dispose();
    });
  }
}

class _FakeOutfitRepository implements OutfitRepository {
  _FakeOutfitRepository({this.error, this.response, this.gate});

  final Object? error;
  final OutfitAnalysis? response;
  final Completer<void>? gate;
  bool closed = false;
  int generateCalls = 0;

  @override
  Future<OutfitAnalysis> generateOutfit(OutfitRequest request) async {
    generateCalls += 1;
    await gate?.future;
    if (error != null) {
      throw error!;
    }

    return response ??
        const OutfitAnalysis(
          bodyAnalysis: '身体分析',
          style: '极简',
          top: '上衣',
          bottom: '下装',
          shoes: '鞋子',
          accessories: '配饰',
          suggestion: '总结',
        );
  }

  @override
  void close() {
    closed = true;
  }
}
