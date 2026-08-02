import '../models/outfit_analysis.dart';
import '../models/outfit_request.dart';
import '../services/ai_service.dart';

abstract interface class OutfitRepository {
  Future<OutfitAnalysis> generateOutfit(OutfitRequest request);

  void close();
}

class RemoteOutfitRepository implements OutfitRepository {
  RemoteOutfitRepository({AIService? service})
      : _service = service ?? AIService();

  final AIService _service;

  @override
  Future<OutfitAnalysis> generateOutfit(OutfitRequest request) {
    return _service.generateOutfit(request);
  }

  @override
  void close() {
    _service.close();
  }
}
