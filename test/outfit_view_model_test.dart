import 'dart:async';

import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:fit_ai/models/outfit_request.dart';
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
    expect(viewModel.analysis?.recommendedProducts, hasLength(1));
    expect(
      viewModel.analysis?.recommendedProducts.first.id,
      MockProductDatabase.products.first.id,
    );
    expect(viewModel.analysis?.outfitPlan, isNull);
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
