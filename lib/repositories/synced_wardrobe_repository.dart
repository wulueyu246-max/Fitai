import 'package:flutter/foundation.dart';

import '../features/user/services/user_session_controller.dart';
import '../models/ai_recommendation_record.dart';
import '../models/outfit_plan.dart';
import '../models/product.dart';
import '../models/try_on_record.dart';
import '../models/wardrobe_snapshot.dart';
import '../services/favorite_service.dart';
import '../services/wardrobe_sync_service.dart';
import 'wardrobe_repository.dart';

class SyncedWardrobeRepository implements WardrobeRepository {
  SyncedWardrobeRepository({
    required this.sessionController,
    required this.syncService,
    FavoriteService? favoriteService,
  }) : _favoriteService = favoriteService ?? FavoriteService.instance;

  final UserSessionController sessionController;
  final WardrobeSyncService syncService;
  final FavoriteService _favoriteService;
  String? _pulledForUserId;

  @override
  Listenable get changes => _favoriteService;

  @override
  Future<WardrobeSnapshot> load() async {
    await _favoriteService.ensureLoaded();
    final userId = sessionController.account?.id;
    if (userId != null && _pulledForUserId != userId) {
      try {
        final remote = await syncService.pull();
        if (remote != null) {
          await _favoriteService.mergeSnapshot(remote);
          await syncService.push(_favoriteService.snapshot);
        }
        _pulledForUserId = userId;
      } catch (_) {
        // Offline users continue with their local wardrobe. A later mutation
        // or reload retries synchronization.
      }
    }
    return _favoriteService.snapshot;
  }

  @override
  Future<bool> toggleProduct(Product product) async {
    final selected = await _favoriteService.toggleProduct(product);
    await _pushSafely();
    return selected;
  }

  @override
  Future<bool> toggleOutfitPlan(OutfitPlan plan) async {
    final selected = await _favoriteService.toggleOutfitPlan(plan);
    await _pushSafely();
    return selected;
  }

  @override
  Future<void> saveTryOnRecord(TryOnRecord record) async {
    await _favoriteService.addTryOnRecord(record);
    await _pushSafely();
  }

  @override
  Future<void> saveAIRecommendation(AIRecommendationRecord record) async {
    await _favoriteService.addAIRecommendation(record);
    await _pushSafely();
  }

  Future<void> _pushSafely() async {
    if (!sessionController.isAuthenticated) {
      return;
    }
    try {
      await syncService.push(_favoriteService.snapshot);
      _pulledForUserId = sessionController.account?.id;
    } catch (_) {
      // Local data remains authoritative while offline and is retried later.
    }
  }
}
