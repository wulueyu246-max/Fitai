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
      // AI product entries are non-purchasable suggestions. ProductService
      // replaces them with catalog-backed products after matching succeeds.
      _analysis = OutfitAnalysis(
        bodyAnalysis: response.bodyAnalysis,
        style: response.style,
        top: response.top,
        bottom: response.bottom,
        shoes: response.shoes,
        accessories: response.accessories,
        suggestion: response.suggestion,
        analysisMode: response.analysisMode,
        recommendedProducts: response.recommendedProducts,
      );
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

  void attachRecommendations(
    List<Product> products, {
    required OutfitPlan outfitPlan,
  }) {
    final analysis = _analysis;

    if (analysis == null) {
      return;
    }

    _analysis = analysis.copyWith(
      recommendedProducts: List<Product>.unmodifiable(products),
      outfitPlan: outfitPlan,
    );
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
