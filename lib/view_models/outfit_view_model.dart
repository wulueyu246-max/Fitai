import 'package:flutter/foundation.dart';

import '../models/outfit_analysis.dart';
import '../models/outfit_plan.dart';
import '../models/outfit_request.dart';
import '../models/product.dart';
import '../repositories/outfit_repository.dart';
import '../services/ai_service.dart';

class OutfitViewModel extends ChangeNotifier {
  OutfitViewModel({required OutfitRepository repository})
      : _repository = repository;

  final OutfitRepository _repository;

  OutfitAnalysis? _analysis;
  bool _isLoading = false;
  bool _isDisposed = false;
  String? _errorMessage;
  String? _requestId;

  OutfitAnalysis? get analysis => _analysis;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String? get requestId => _requestId;

  Future<bool> generateOutfit(OutfitRequest request) async {
    if (_isLoading) {
      return false;
    }

    _isLoading = true;
    _errorMessage = null;
    _requestId = null;
    _notifyListeners();

    try {
      final response = await _repository.generateOutfit(request);
      final responseRequestId = response.requestId?.trim() ?? '';
      final effectiveRequestId = responseRequestId.isNotEmpty
          ? responseRequestId
          : 'client-look-${DateTime.now().microsecondsSinceEpoch}';
      // AI product entries are non-purchasable suggestions. ProductService
      // replaces them with catalog-backed products after matching succeeds.
      _analysis = response.copyWith(
        recommendedProducts: const [],
        productRecommendations: const [],
        requestId: effectiveRequestId,
        outfitPlan: null,
      );
      _requestId = effectiveRequestId;
      return true;
    } on AIServiceException catch (error) {
      _errorMessage = error.message;
      _requestId = error.requestId;
      return false;
    } catch (_) {
      _errorMessage = '生成失败，请稍后重试';
      return false;
    } finally {
      _isLoading = false;
      _notifyListeners();
    }
  }

  bool attachRecommendations(
    List<Product> products, {
    OutfitPlan? outfitPlan,
    required String expectedRequestId,
    required String expectedGender,
  }) {
    final analysis = _analysis;

    if (analysis == null ||
        analysis.requestId?.trim() != expectedRequestId.trim() ||
        _normalizeGender(analysis.gender) != _normalizeGender(expectedGender) ||
        (outfitPlan != null &&
            !outfitPlan.matchesCurrentResult(
              requestId: expectedRequestId,
              gender: expectedGender,
            ))) {
      return false;
    }

    _analysis = analysis.copyWith(
      recommendedProducts: List<Product>.unmodifiable(products),
      outfitPlan: outfitPlan,
    );
    _notifyListeners();
    return true;
  }

  String _normalizeGender(String value) {
    return switch (value.trim().toLowerCase()) {
      'male' || '男' || '男性' || '男士' => 'male',
      'female' || '女' || '女性' || '女士' => 'female',
      _ => 'unisex',
    };
  }

  void clearResult() {
    _analysis = null;
    _errorMessage = null;
    _requestId = null;
    _notifyListeners();
  }

  void replaceOutfitProduct(Product product) {
    final analysis = _analysis;
    final plan = analysis?.outfitPlan;
    if (analysis == null || plan == null) {
      return;
    }
    _analysis = analysis.copyWith(outfitPlan: plan.replaceProduct(product));
    _notifyListeners();
  }

  void _notifyListeners() {
    if (!_isDisposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _isDisposed = true;
    _repository.close();
    super.dispose();
  }
}
