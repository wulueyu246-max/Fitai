import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/logging/app_logger.dart';
import '../components/ai_outfit_report.dart';
import '../components/outfit_plan_card.dart';
import '../components/outfit_recommendation_card.dart';
import '../components/personal_outfit_header.dart';
import '../components/recommendation_feedback_card.dart';
import '../models/ai_recommendation_record.dart';
import '../models/app_location.dart';
import '../models/outfit.dart';
import '../models/outfit_request.dart';
import '../models/product.dart';
import '../models/product_analytics.dart';
import '../models/recommendation_feedback.dart';
import '../models/try_on_request.dart';
import '../models/weather_snapshot.dart';
import '../repositories/outfit_repository.dart';
import '../repositories/wardrobe_repository.dart';
import '../services/affiliate_service.dart';
import '../services/analytics_service.dart';
import '../services/favorite_service.dart';
import '../services/feedback_event_service.dart';
import '../services/body_profile_service.dart';
import '../services/body_photo_picker.dart';
import '../services/consent_service.dart';
import '../services/image_data_service.dart';
import '../services/product_service.dart';
import '../services/photo_storage_service.dart';
import '../services/product_analytics_service.dart';
import '../services/recommendation_feedback_service.dart';
import '../services/user_profile_service.dart';
import '../services/virtual_try_on_service.dart';
import '../services/location_service.dart';
import '../services/weather_service.dart';
import '../services/weather_outfit_advisor.dart';
import '../view_models/outfit_view_model.dart';
import '../features/user/services/user_session_controller.dart';
import '../features/share/widgets/share_outfit_sheet.dart';
import 'product_detail_page.dart';
import 'legal_consent_page.dart';

class AiOutfitPage extends StatefulWidget {
  const AiOutfitPage({
    super.key,
    this.repository,
    this.imageDataService,
    this.bodyPhotoPicker,
    this.productService,
    this.tryOnService,
    this.wardrobeRepository,
    this.consentService,
    this.sessionController,
    this.analyticsService,
    this.initialScene,
    this.initialHeight,
    this.initialWeight,
    this.initialRequest,
    this.feedbackEventService,
    this.locationService,
    this.weatherService,
    this.photoStorageService,
    this.onTryOn,
  });

  final OutfitRepository? repository;
  final ImageDataService? imageDataService;
  final BodyPhotoPicker? bodyPhotoPicker;
  final ProductService? productService;
  final VirtualTryOnService? tryOnService;
  final WardrobeRepository? wardrobeRepository;
  final ConsentService? consentService;
  final UserSessionController? sessionController;
  final AnalyticsService? analyticsService;
  final String? initialScene;
  final double? initialHeight;
  final double? initialWeight;
  final String? initialRequest;
  final FeedbackEventService? feedbackEventService;
  final LocationService? locationService;
  final WeatherService? weatherService;
  final PhotoStorageService? photoStorageService;
  final ValueChanged<TryOnRequest>? onTryOn;

  @override
  State<AiOutfitPage> createState() => _AiOutfitPageState();
}

class _AiOutfitPageState extends State<AiOutfitPage> {
  final TextEditingController _heightController = TextEditingController();

  final TextEditingController _weightController = TextEditingController();

  final TextEditingController _requestController = TextEditingController();
  static const _sceneOptions = ['日常', '工作', '约会', '聚会', '旅行'];
  static const _photoRoleLabels = {
    'front': '正面照',
    'side': '侧面照',
    'back': '背面照',
  };
  late String _scene;

  XFile? _frontImage;

  XFile? _sideImage;

  XFile? _backImage;
  final Map<String, Uint8List> _previewBytes = {};

  late final OutfitViewModel _viewModel;
  late final ImageDataService _imageDataService;
  late final BodyPhotoPicker _bodyPhotoPicker;
  late final ProductService _productService;
  late final VirtualTryOnService _tryOnService;
  late final WardrobeRepository _wardrobeRepository;
  late final ConsentService _consentService;
  late final UserSessionController _session;
  late final AnalyticsService _analytics;
  late final FeedbackEventService _feedbackEventService;
  late final LocationService _locationService;
  late final WeatherService _weatherService;
  late final PhotoStorageService _photoStorageService;
  static const WeatherOutfitAdvisor _weatherAdvisor = WeatherOutfitAdvisor();
  final FavoriteService _favoriteService = FavoriteService.instance;
  final RecommendationFeedbackService _feedbackService =
      RecommendationFeedbackService.instance;
  final UserProfileService _profileService = UserProfileService();
  final ProductAnalyticsService _productAnalytics =
      ProductAnalyticsService.instance;
  final AffiliateService _affiliateService = LocalAffiliateService();
  final Set<String> _submittedFeedbackPlanIds = {};
  OutfitRequest? _lastRequest;
  Set<String> _selectedProductIds = {};
  bool _isLoadingProducts = false;
  String? _productLoadError;
  bool _isRegeneratingPlan = false;
  bool _isGenerating = false;
  String? _tryingOnProductId;
  WeatherSnapshot? _weather;
  AppLocation? _location;

  @override
  void initState() {
    super.initState();
    if (widget.initialHeight case final height?) {
      _heightController.text = height.toStringAsFixed(0);
    }
    if (widget.initialWeight case final weight?) {
      _weightController.text = weight.toStringAsFixed(0);
    }
    _requestController.text = widget.initialRequest ?? '';
    _scene = _sceneOptions.contains(widget.initialScene)
        ? widget.initialScene!
        : '日常';
    _viewModel = OutfitViewModel(
      repository: widget.repository ?? RemoteOutfitRepository(),
    );
    _imageDataService = widget.imageDataService ?? ImageDataService();
    _bodyPhotoPicker = widget.bodyPhotoPicker ?? SystemGalleryBodyPhotoPicker();
    _productService = widget.productService ?? const MockProductService();
    _tryOnService = widget.tryOnService ?? const MockVirtualTryOnService();
    _wardrobeRepository =
        widget.wardrobeRepository ?? LocalWardrobeRepository();
    _consentService = widget.consentService ?? ConsentService.instance;
    _session = widget.sessionController ?? UserSessionController.instance;
    _analytics = widget.analyticsService ?? LocalAnalyticsService.instance;
    _feedbackEventService =
        widget.feedbackEventService ?? FeedbackEventService.instance;
    _locationService = widget.locationService ?? DeviceLocationService();
    _weatherService = widget.weatherService ?? WeatherService();
    _photoStorageService = widget.photoStorageService ??
        PhotoStorageService.fromEnvironment(_session);
    _favoriteService
      ..addListener(_onFavoritesChanged)
      ..ensureLoaded();
    unawaited(_loadWeather());
    unawaited(_recoverLostImages());
  }

  Future<void> _loadWeather() async {
    try {
      final location = await _locationService.load();
      if (location == null) return;
      if (mounted) setState(() => _location = location);
      final weather = await _weatherService.fetch(location);
      if (mounted) setState(() => _weather = weather);
    } catch (_) {
      // Weather improves recommendations but never blocks photo analysis.
    }
  }

  Future<void> _recoverLostImages() async {
    try {
      final images = await _bodyPhotoPicker.retrieveLostGalleryImages();
      if (images.isNotEmpty && mounted) {
        await _handlePickedImages(images);
      }
    } catch (_) {
      // Lost-data recovery is Android-only and best effort.
    }
  }

  @override
  void dispose() {
    for (final bytes in _previewBytes.values) {
      unawaited(MemoryImage(bytes).evict());
    }
    _previewBytes.clear();
    _frontImage = null;
    _sideImage = null;
    _backImage = null;
    _lastRequest = null;
    _heightController.dispose();

    _weightController.dispose();

    _requestController.dispose();

    _viewModel.dispose();
    _favoriteService.removeListener(_onFavoritesChanged);

    super.dispose();
  }

  void _onFavoritesChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _pickPhotos() async {
    if (!await _ensurePhotoConsent()) {
      return;
    }
    if (!mounted) return;

    try {
      final images = await _bodyPhotoPicker.pickFromGallery(limit: 3);
      if (!mounted || images.isEmpty) return;
      await _handlePickedImages(images);
    } catch (error, stackTrace) {
      AppLogger.instance.error(
        'photo_picker_failed',
        error: error,
        stackTrace: stackTrace,
        metadata: const {'source': 'system_gallery'},
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("无法读取图片，请检查照片访问权限")),
        );
      }
    }
  }

  Future<void> _handlePickedImages(List<XFile> pickedImages) async {
    final wasLimited = pickedImages.length > 3;
    final selectedImages = pickedImages.take(3).toList(growable: false);
    if (wasLimited && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('最多选择3张照片，已保留前3张')),
      );
    }

    final candidates = <_PendingBodyPhoto>[];
    try {
      for (final image in selectedImages) {
        candidates.add(
          _PendingBodyPhoto(
            image: image,
            bytes: await _imageDataService.readValidatedBytes(image),
          ),
        );
      }
    } on ImageDataException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.message)),
        );
      }
      return;
    }

    if (!mounted || candidates.isEmpty) return;

    if (candidates.length == 1) {
      _applyPhotoAssignments({'front': candidates.single});
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已将所选照片设为正面照')),
      );
      return;
    }

    final assignments = await _confirmPhotoRoles(candidates);
    if (assignments != null && mounted) {
      _applyPhotoAssignments(assignments);
    }
  }

  Future<Map<String, _PendingBodyPhoto>?> _confirmPhotoRoles(
    List<_PendingBodyPhoto> photos,
  ) {
    final assignments = List<String>.filled(photos.length, '');

    return showModalBottomSheet<Map<String, _PendingBodyPhoto>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) {
          final isValid = assignments.every((role) => role.isNotEmpty) &&
              assignments.contains('front') &&
              assignments.toSet().length == assignments.length;
          return SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(
              20,
              0,
              20,
              20 + MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '确认照片角度',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                const Text(
                  '请为每张照片选择不同角度，并至少指定一张正面照。',
                  style: TextStyle(color: Colors.black54),
                ),
                const SizedBox(height: 16),
                for (final (index, photo) in photos.indexed)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.memory(
                            photo.bytes,
                            width: 64,
                            height: 88,
                            fit: BoxFit.cover,
                            cacheWidth: 256,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: DropdownButton<String>(
                            key: Key('photo-role-$index'),
                            value: assignments[index],
                            isExpanded: true,
                            items: [
                              const DropdownMenuItem(
                                value: '',
                                child: Text('选择照片角度'),
                              ),
                              for (final entry in _photoRoleLabels.entries)
                                if (!assignments.contains(entry.key) ||
                                    assignments[index] == entry.key)
                                  DropdownMenuItem(
                                    value: entry.key,
                                    child: Text(entry.value),
                                  ),
                            ],
                            onChanged: (role) {
                              if (role == null) return;
                              setSheetState(() => assignments[index] = role);
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
                if (!isValid)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 12),
                    child: Text(
                      '每张照片需选择不同角度，且正面照必填。',
                      style: TextStyle(color: Color(0xFF9A4F38)),
                    ),
                  ),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    key: const Key('confirm-photo-roles'),
                    onPressed: isValid
                        ? () => Navigator.pop(
                              context,
                              {
                                for (final (index, role) in assignments.indexed)
                                  role: photos[index],
                              },
                            )
                        : null,
                    child: const Text('确认照片角度'),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _applyPhotoAssignments(Map<String, _PendingBodyPhoto> assignments) {
    for (final bytes in _previewBytes.values) {
      unawaited(MemoryImage(bytes).evict());
    }

    setState(() {
      _previewBytes
        ..clear()
        ..addEntries(
          assignments.entries.map(
            (entry) => MapEntry(entry.key, entry.value.bytes),
          ),
        );
      _frontImage = assignments['front']?.image;
      _sideImage = assignments['side']?.image;
      _backImage = assignments['back']?.image;
    });
  }

  void _removeSelectedImage(String role) {
    final bytes = _previewBytes.remove(role);
    if (bytes != null) {
      unawaited(MemoryImage(bytes).evict());
    }
    setState(() {
      if (role == 'front') _frontImage = null;
      if (role == 'side') _sideImage = null;
      if (role == 'back') _backImage = null;
    });
  }

  Future<void> _generateOutfit() async {
    if (_isGenerating || _viewModel.isLoading) {
      return;
    }

    setState(() => _isGenerating = true);
    FocusScope.of(context).unfocus();

    try {
      final height = double.tryParse(_heightController.text.trim());
      final weight = double.tryParse(_weightController.text.trim());

      if (height == null ||
          height < 40 ||
          height > 260 ||
          weight == null ||
          weight < 10 ||
          weight > 500 ||
          _frontImage == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text("请填写有效的身高体重，并上传正面全身照"),
          ),
        );
        return;
      }

      if (!await _ensurePhotoConsent()) {
        return;
      }

      final selectedImages = <String, XFile>{
        "front": _frontImage!,
      };

      if (_sideImage != null) {
        selectedImages["side"] = _sideImage!;
      }

      if (_backImage != null) {
        selectedImages["back"] = _backImage!;
      }

      final selectedBytes = <String, Uint8List>{
        for (final role in selectedImages.keys)
          if (_previewBytes[role] case final bytes?) role: bytes,
      };
      final images = await _imageDataService.encodeImages(
        selectedImages,
        cachedBytes: selectedBytes,
      );
      await _photoStorageService.storePhotos(images);
      unawaited(
        _analytics.track(
          'photo_upload_completed',
          userId: _session.account?.id ?? 'local-demo-user',
          properties: {
            'scene': _scene,
            'imageCount': images.length.toString(),
          },
        ),
      );
      final userRequest = _requestController.text.trim();
      final weatherInstruction = _weather == null
          ? (_location == null
              ? ''
              : '用户地区：${_location!.country} ${_location!.city}；'
                  '场景：$_scene。请结合当地气候生成建议。')
          : _weatherAdvisor.buildPrompt(
              weather: _weather!,
              scene: _scene,
              location: _location,
            );
      final outfitRequest = OutfitRequest(
        height: height,
        weight: weight,
        scene: _scene,
        request: [userRequest, weatherInstruction]
            .where((value) => value.isNotEmpty)
            .join(' '),
        images: images,
      );
      final succeeded = await _viewModel.generateOutfit(outfitRequest);

      if (!mounted) {
        return;
      }

      if (succeeded) {
        unawaited(
          _analytics.track(
            'outfit_generated',
            userId: _session.account?.id ?? 'local-demo-user',
            properties: {'scene': _scene},
          ),
        );
        _lastRequest = outfitRequest;
        await _loadProductRecommendations(outfitRequest);
        _requestController.clear();
      } else {
        final requestId = _viewModel.requestId;
        final supportReference = requestId == null ? "" : "\n请求编号：$requestId";
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              "${_viewModel.errorMessage ?? "生成失败，请稍后重试"}$supportReference",
            ),
          ),
        );
      }
    } on ImageDataException catch (error, stackTrace) {
      AppLogger.instance.warning(
        'image_encoding_rejected',
        metadata: {
          'errorType': error.runtimeType.toString(),
          'hasStackTrace': stackTrace.toString().isNotEmpty,
        },
      );
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    } catch (error, stackTrace) {
      AppLogger.instance.error(
        'outfit_generation_failed',
        error: error,
        stackTrace: stackTrace,
        metadata: {'scene': _scene},
      );
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("生成失败，请稍后重试")),
      );
    } finally {
      if (mounted) {
        setState(() => _isGenerating = false);
      } else {
        _isGenerating = false;
      }
    }
  }

  Future<bool> _ensurePhotoConsent() async {
    final current = await _consentService.load();
    if (current.hasRequiredConsent) {
      return true;
    }
    if (!mounted) {
      return false;
    }
    final granted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => LegalConsentPage(
          service: _consentService,
          requirePhotoConsent: true,
        ),
      ),
    );
    return granted == true;
  }

  Future<void> _loadProductRecommendations(OutfitRequest request) async {
    final analysis = _viewModel.analysis;

    if (analysis == null) {
      return;
    }

    setState(() {
      _isLoadingProducts = true;
      _productLoadError = null;
      _selectedProductIds = {};
    });

    late final List<Product> products;
    try {
      final catalogProducts = analysis.productRecommendations.isNotEmpty
          ? analysis.recommendedProducts
          : await _productService.recommendProducts(
              analysis: analysis,
              request: request,
            );
      final rawProducts = catalogProducts.isEmpty
          ? analysis.recommendedProducts
          : catalogProducts;
      products = _weather == null
          ? rawProducts
          : _weatherAdvisor.adaptProducts(
              products: rawProducts,
              weather: _weather!,
              scene: request.scene,
            );
      if (products.isEmpty) {
        throw StateError('商品接口返回的 products 数组为空');
      }

      if (!mounted) {
        return;
      }

      final selectedCategories = <String>{};
      final selectedProductIds = <String>{};

      for (final product in products) {
        if (selectedCategories.add(product.wardrobeSlot)) {
          selectedProductIds.add(product.id);
        }
      }

      _viewModel.attachRecommendations(products);
      setState(() {
        _selectedProductIds = selectedProductIds;
        _isLoadingProducts = false;
        _productLoadError = null;
      });
    } catch (error, stackTrace) {
      AppLogger.instance.error(
        'product_recommendations_failed',
        error: error,
        stackTrace: stackTrace,
        metadata: {'message': error.toString()},
      );
      if (!mounted) {
        return;
      }

      final existingProducts =
          _viewModel.analysis?.recommendedProducts ?? const <Product>[];
      setState(() {
        _isLoadingProducts = false;
        _productLoadError = existingProducts.isEmpty ? '商品匹配失败，请检查网络后重试' : null;
      });
      if (existingProducts.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('商品匹配失败，请稍后重试')),
        );
      }
      return;
    }

    unawaited(
      _productAnalytics.recordImpressions(
        products,
        source: 'ai-outfit-recommendations',
        userId: _session.account?.id ?? 'local-demo-user',
      ),
    );

    try {
      final outfitPlan = await _productService.createOutfitPlan(
        products: products,
        analysis: analysis,
        request: request,
      );
      if (!mounted) {
        return;
      }
      _viewModel.attachRecommendations(products, outfitPlan: outfitPlan);
      final profile = await _profileService.load();
      final mergedProfile = await _profileService.mergeAnalysis(
        profile: profile,
        height: request.height,
        weight: request.weight,
        bodyType: analysis.bodyAnalysis,
        style: analysis.style,
        photos: request.images,
        favoriteProductIds: _favoriteService.productIds,
      );
      await _profileService.recordOutfit(mergedProfile, outfitPlan.id);
      final createdTime = DateTime.now();
      try {
        await _wardrobeRepository.saveAIRecommendation(
          AIRecommendationRecord(
            id: 'ai-${createdTime.microsecondsSinceEpoch}',
            scene: request.scene,
            bodyAnalysis: analysis.bodyAnalysis,
            style: analysis.style,
            outfitPlan: outfitPlan,
            createdTime: createdTime,
          ),
        );
      } catch (_) {
        // Recommendation history must not block the current result.
      }
    } catch (error, stackTrace) {
      AppLogger.instance.error(
        'product_post_processing_failed',
        error: error,
        stackTrace: stackTrace,
        metadata: {
          'message': error.toString(),
          'productsLength': products.length,
        },
      );
    }
  }

  void _toggleProduct(Product product) {
    final products = _viewModel.analysis?.recommendedProducts ?? const [];

    setState(() {
      final updatedIds = Set<String>.from(_selectedProductIds);

      if (updatedIds.contains(product.id)) {
        updatedIds.remove(product.id);
      } else {
        for (final candidate in products) {
          if (candidate.wardrobeSlot == product.wardrobeSlot) {
            updatedIds.remove(candidate.id);
          }
        }
        updatedIds.add(product.id);
      }

      _selectedProductIds = updatedIds;
    });
  }

  void _replacePlanProduct(String wardrobeSlot) {
    final analysis = _viewModel.analysis;
    final currentPlan = analysis?.outfitPlan;
    if (analysis == null || currentPlan == null) {
      return;
    }
    final current = currentPlan.products.firstWhere(
      (product) => product.wardrobeSlot == wardrobeSlot,
    );
    final alternatives = analysis.recommendedProducts
        .where(
          (product) =>
              product.wardrobeSlot == wardrobeSlot && product.id != current.id,
        )
        .toList(growable: false);
    if (alternatives.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('当前没有更多同类商品可替换')),
      );
      return;
    }
    final replacement = alternatives.first;
    _viewModel.replaceOutfitProduct(replacement);
    setState(() {
      _selectedProductIds = {
        ..._selectedProductIds.where((id) => id != current.id),
        replacement.id,
      };
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('已换成 ${replacement.brand} ${replacement.name}')),
    );
  }

  Future<void> _regenerateOutfitPlan() async {
    final analysis = _viewModel.analysis;
    final request = _lastRequest;
    final currentPlan = analysis?.outfitPlan;
    if (analysis == null || request == null || currentPlan == null) {
      return;
    }
    setState(() => _isRegeneratingPlan = true);
    try {
      Product nextFor(String slot) {
        final candidates = analysis.recommendedProducts
            .where((product) => product.wardrobeSlot == slot)
            .toList(growable: false);
        final current = currentPlan.products.firstWhere(
          (product) => product.wardrobeSlot == slot,
        );
        if (candidates.length < 2) {
          return current;
        }
        final index = candidates.indexWhere((item) => item.id == current.id);
        return candidates[(index + 1) % candidates.length];
      }

      final replacements = [
        nextFor(ProductCategory.top),
        nextFor(ProductCategory.bottom),
        nextFor(ProductCategory.shoes),
      ];
      final reordered = [
        ...replacements,
        ...analysis.recommendedProducts.where(
          (candidate) =>
              !replacements.any((product) => product.id == candidate.id),
        ),
      ];
      final plan = await _productService.createOutfitPlan(
        products: reordered,
        analysis: analysis,
        request: request,
      );
      _viewModel.attachRecommendations(
        analysis.recommendedProducts,
        outfitPlan: plan,
      );
      await Future.wait([
        _profileService
            .load()
            .then((profile) => _profileService.recordOutfit(profile, plan.id)),
        _wardrobeRepository.saveAIRecommendation(
          AIRecommendationRecord(
            id: 'ai-${DateTime.now().microsecondsSinceEpoch}',
            scene: request.scene,
            bodyAnalysis: analysis.bodyAnalysis,
            style: analysis.style,
            outfitPlan: plan,
            createdTime: DateTime.now(),
          ),
        ),
        _analytics.track(
          'outfit_plan_regenerated',
          userId: _session.account?.id ?? 'local-demo-user',
          properties: {'scene': request.scene},
        ),
      ]);
      if (!mounted) {
        return;
      }
      setState(() {
        _selectedProductIds = replacements.map((item) => item.id).toSet();
      });
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('暂时无法更换整套方案，请稍后重试')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isRegeneratingPlan = false);
      }
    }
  }

  Future<void> _openVirtualTryOn([Product? focusedProduct]) async {
    final request = _lastRequest;
    final analysis = _viewModel.analysis;
    final onTryOn = widget.onTryOn;

    if (request == null || analysis == null || onTryOn == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('当前无法打开 AI 试穿，请重新生成方案')),
      );
      return;
    }

    var selectedProducts = analysis.recommendedProducts
        .where((product) => _selectedProductIds.contains(product.id))
        .toList(growable: false);

    if (focusedProduct != null &&
        !selectedProducts.any((product) => product.id == focusedProduct.id)) {
      selectedProducts = [
        ...selectedProducts.where(
          (product) => product.wardrobeSlot != focusedProduct.wardrobeSlot,
        ),
        focusedProduct,
      ];
    }

    if (selectedProducts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请至少选择一件商品')),
      );
      return;
    }

    final product = focusedProduct ?? selectedProducts.first;
    final basePlan = analysis.outfitPlan ??
        await _productService.createOutfitPlan(
          products: selectedProducts,
          analysis: analysis,
          request: request,
        );
    var outfitPlan = basePlan;
    for (final selectedProduct in selectedProducts) {
      outfitPlan = outfitPlan.replaceProduct(selectedProduct);
    }
    final orderedProducts = [
      product,
      ...selectedProducts.where((candidate) => candidate.id != product.id),
    ];
    final outfit = Outfit(
      userId: _session.account?.id ?? 'local-demo-user',
      height: request.height,
      weight: request.weight,
      bodyType: analysis.bodyAnalysis,
      style: analysis.style,
      userImages: request.images,
      products: orderedProducts,
    );

    setState(() {
      _tryingOnProductId = product.id;
    });

    try {
      final virtualModel = await _tryOnService.generateVirtualModel(outfit);
      await _feedbackService.record(
        action: RecommendationFeedbackAction.tryOn,
        productId: product.id,
        outfitPlanId: outfitPlan.id,
        source: 'ai-outfit-result',
      );
      await _productAnalytics.record(
        action: ProductAnalyticsAction.tryOn,
        product: product,
        source: 'ai-outfit-result',
        userId: _session.account?.id ?? 'local-demo-user',
      );
      final profile = await _profileService.load();
      final updatedProfile =
          await _profileService.recordTryOn(profile, product.id);

      if (!mounted) {
        return;
      }

      onTryOn(
        TryOnRequest(
          userId: outfit.userId,
          virtualModel: virtualModel,
          products: List<Product>.unmodifiable(orderedProducts),
          outfitPlan: outfitPlan,
          userProfile: updatedProfile,
          userImage: request.images['front'] ?? '',
          createdTime: DateTime.now(),
        ),
      );
    } catch (_) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('虚拟模特准备失败，请稍后重试')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _tryingOnProductId = null;
        });
      }
    }
  }

  Future<void> _showProductDetails(Product product) async {
    await Future.wait([
      _feedbackService.record(
        action: RecommendationFeedbackAction.click,
        productId: product.id,
        outfitPlanId: _viewModel.analysis?.outfitPlan?.id,
        source: 'ai-outfit-product',
      ),
      _affiliateService.recordProductClick(
        product: product,
        source: 'ai-outfit-product',
        userId: _session.account?.id ?? 'local-demo-user',
      ),
    ]);
    if (!mounted) {
      return;
    }
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ProductDetailPage(
          product: product,
          userId: _session.account?.id ?? 'local-demo-user',
          trackOpen: false,
          onFavorite: _toggleFavoriteProduct,
          onAddToWardrobe: _addProductToWardrobe,
          onTryOn: widget.onTryOn == null
              ? null
              : (selected) => _openVirtualTryOn(selected),
          onPurchase: _recordPurchaseIntent,
        ),
      ),
    );
  }

  Future<void> _addProductToWardrobe(Product product) async {
    if (!_favoriteService.isProductFavorite(product.id)) {
      await _toggleFavoriteProduct(product);
    }
  }

  Future<void> _recordPurchaseIntent(Product product) async {
    await _feedbackService.record(
      action: RecommendationFeedbackAction.purchase,
      productId: product.id,
      outfitPlanId: _viewModel.analysis?.outfitPlan?.id,
      source: 'ai-outfit-product-detail',
    );
    final profile = await _profileService.load();
    await _profileService.recordPurchase(profile, product.sku);
  }

  Future<void> _toggleFavoriteProduct(Product product) async {
    final isFavorite = await _wardrobeRepository.toggleProduct(product);
    final profile = await _profileService.load();
    await _profileService.syncFavorites(
      profile,
      _favoriteService.productIds,
    );
    if (isFavorite) {
      await Future.wait([
        _feedbackService.record(
          action: RecommendationFeedbackAction.favorite,
          productId: product.id,
          outfitPlanId: _viewModel.analysis?.outfitPlan?.id,
          source: 'ai-outfit-product',
        ),
        _productAnalytics.record(
          action: ProductAnalyticsAction.favorite,
          product: product,
          source: 'ai-outfit-product',
          userId: _session.account?.id ?? 'local-demo-user',
        ),
      ]);
    }
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(isFavorite ? '商品已收藏' : '已取消收藏商品')),
    );
  }

  Future<void> _toggleFavoritePlan() async {
    final plan = _viewModel.analysis?.outfitPlan;
    if (plan == null) {
      return;
    }
    final isFavorite = await _wardrobeRepository.toggleOutfitPlan(plan);
    if (isFavorite) {
      await _feedbackService.record(
        action: RecommendationFeedbackAction.favorite,
        outfitPlanId: plan.id,
        source: 'ai-outfit-plan',
      );
    }
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(isFavorite ? '穿搭方案已保存' : '已取消保存方案')),
    );
  }
  // 基础信息区域

  Widget _buildBodyInfo() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            "基础身体信息",
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('ai-height'),
                  controller: _heightController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: "身高",
                    suffixText: "cm",
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: TextField(
                  key: const Key('ai-weight'),
                  controller: _weightController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: "体重",
                    suffixText: "kg",
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // 单个照片卡片

  Widget _buildPhotoCard(
    String title,
    String description,
    String type,
    XFile? image,
  ) {
    final previewBytes = _previewBytes[type];
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Semantics(
        button: true,
        label: image == null
            ? "上传$title，$description"
            : "已选择$title，可删除或使用上方按钮重新选择",
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(22),
          child: InkWell(
            key: Key('photo-upload-$type'),
            borderRadius: BorderRadius.circular(22),
            onTap: _isGenerating || image != null ? null : _pickPhotos,
            child: Ink(
              width: double.infinity,
              height: 150,
              decoration: BoxDecoration(
                color: const Color(0xffF8F7F3),
                borderRadius: BorderRadius.circular(22),
              ),
              child: image == null
                  ? Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.add_a_photo_outlined,
                          size: 32,
                          color: Colors.black54,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          title,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          description,
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.black54,
                          ),
                        ),
                      ],
                    )
                  : Stack(
                      fit: StackFit.expand,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(22),
                          child: previewBytes != null
                              ? Image.memory(
                                  previewBytes,
                                  fit: BoxFit.contain,
                                  cacheWidth: 720,
                                  gaplessPlayback: true,
                                )
                              : const Center(
                                  child: CircularProgressIndicator(),
                                ),
                        ),
                        Positioned(
                          top: 8,
                          right: 8,
                          child: IconButton.filled(
                            key: Key('remove-photo-$type'),
                            tooltip: '删除$title',
                            onPressed: _isGenerating
                                ? null
                                : () => _removeSelectedImage(type),
                            icon: const Icon(Icons.close, size: 18),
                          ),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPhotoSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          "身体照片扫描",
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          "可一次选择1至3张照片。仅上传正面照也可生成结果，补充侧面照和背面照可提升体型分析准确度。",
          style: TextStyle(
            fontSize: 14,
            color: Colors.black54,
          ),
        ),
        const SizedBox(height: 14),
        SizedBox(
          width: double.infinity,
          child: FilledButton.tonalIcon(
            key: const Key('photo-gallery-picker'),
            onPressed: _isGenerating ? null : _pickPhotos,
            icon: const Icon(Icons.photo_library_outlined),
            label: const Text('从相册选择照片'),
          ),
        ),
        const SizedBox(height: 16),
        _buildPhotoCard(
          "正面照：必填",
          "分析肩宽、头身比、身体比例",
          "front",
          _frontImage,
        ),
        _buildPhotoCard(
          "侧面照：可选",
          "分析体态、身体厚度",
          "side",
          _sideImage,
        ),
        _buildPhotoCard(
          "背面照：可选",
          "分析肩型和整体轮廓",
          "back",
          _backImage,
        ),
      ],
    );
  }
  // 穿搭需求输入

  Widget _buildRequestBox() {
    return Container(
      height: 260,
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
      ),
      child: TextField(
        controller: _requestController,
        minLines: 4,
        maxLines: 6,
        decoration: const InputDecoration(
          border: InputBorder.none,
          hintText:
              "告诉 AI 你的穿搭需求\n\n例如：\n\n• 商务会议\n• 日常通勤\n• 约会场景\n• 预算 1000 元以内",
        ),
      ),
    );
  }

  Widget _buildSceneSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          '这次要穿去哪里？',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        const Text(
          '场景会影响版型、颜色和正式程度',
          style: TextStyle(color: Colors.black54),
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 9,
          runSpacing: 9,
          children: [
            for (final scene in _sceneOptions)
              ChoiceChip(
                key: Key('ai-scene-$scene'),
                label: Text(scene),
                selected: _scene == scene,
                onSelected: (_) => setState(() => _scene = scene),
                selectedColor: const Color(0xFF244C3A),
                labelStyle: TextStyle(
                  color: _scene == scene ? Colors.white : Colors.black87,
                  fontWeight: FontWeight.w700,
                ),
              ),
          ],
        ),
      ],
    );
  }

  // 生成按钮

  Widget _buildGenerateButton() {
    final isBusy = _isGenerating || _viewModel.isLoading;
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        key: const Key('generate-outfit'),
        onPressed: isBusy ? null : _generateOutfit,
        style: FilledButton.styleFrom(
          backgroundColor: Colors.black,
          padding: const EdgeInsets.symmetric(
            vertical: 20,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
        ),
        child: Text(
          isBusy ? "AI 正在分析你的身体模型..." : "✦ 生成我的穿搭方案",
          style: const TextStyle(
            fontSize: 16,
            color: Colors.white,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  // AI结果展示

  Widget _buildResult() {
    final analysis = _viewModel.analysis;
    final request = _lastRequest;

    if (analysis == null || request == null) {
      return const SizedBox();
    }
    final profile = const BodyProfileService().build(
      request: request,
      analysis: analysis,
    );

    return Column(
      key: ValueKey('outfit-result-${analysis.hashCode}'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PersonalOutfitHeader(
          imageBytes: _previewBytes['front'],
          scene: request.scene,
        ),
        const SizedBox(height: 16),
        if (analysis.isMock) ...[
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 16),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF3D9),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFF0D495)),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.science_outlined,
                  size: 20,
                  color: Color(0xFF8A641D),
                ),
                SizedBox(width: 9),
                Expanded(
                  child: Text(
                    "演示模式：当前网络无法连接真实视觉模型，以下为本地 Mock 建议，未对照片进行真实识别。",
                    style: TextStyle(
                      color: Color(0xFF76571F),
                      fontSize: 12.5,
                      height: 1.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        AiOutfitReport(analysis: analysis, profile: profile),
        const SizedBox(height: 18),
        if (analysis.outfitPlan case final plan?) ...[
          const Text(
            '今日推荐 Look',
            style: TextStyle(
              color: Color(0xFF211F1C),
              fontSize: 21,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 12),
          OutfitPlanCard(
            plan: plan,
            favorite: _favoriteService.isOutfitPlanFavorite(plan.id),
            onFavorite: _toggleFavoritePlan,
            onTryOn: widget.onTryOn == null ? null : _openVirtualTryOn,
            onProductTap: _showProductDetails,
            onReplaceCategory: _replacePlanProduct,
            onRegenerate: _regenerateOutfitPlan,
            isRegenerating: _isRegeneratingPlan,
            isTryOnLoading: _tryingOnProductId != null,
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              key: const Key('share-ai-outfit-plan'),
              onPressed: () {
                unawaited(
                  _analytics.track(
                    'outfit_share_opened',
                    userId: _session.account?.id ?? 'local-demo-user',
                    properties: {'outfitPlanId': plan.id},
                  ),
                );
                showShareOutfitSheet(
                  context,
                  outfitPlan: plan,
                  userName: _session.account?.displayName ?? '我的树皮穿搭',
                  avatarBase64: _session.account?.avatarBase64,
                );
              },
              icon: const Icon(Icons.ios_share_rounded),
              label: const Text('生成并分享 AI 穿搭卡片'),
            ),
          ),
          const SizedBox(height: 18),
        ],
        OutfitRecommendationCard(
          products: analysis.recommendedProducts,
          selectedProductIds: _selectedProductIds,
          onProductTap: _toggleProduct,
          onViewDetails: _showProductDetails,
          onProductTryOn: widget.onTryOn == null ? null : _openVirtualTryOn,
          favoriteProductIds: _favoriteService.productIds,
          onFavorite: _toggleFavoriteProduct,
          onTryOn: widget.onTryOn == null || _selectedProductIds.isEmpty
              ? null
              : _openVirtualTryOn,
          isLoading: _isLoadingProducts,
          errorMessage: _productLoadError,
          onRetry: _lastRequest == null
              ? null
              : () => _loadProductRecommendations(_lastRequest!),
          tryingOnProductId: _tryingOnProductId,
        ),
        if (analysis.outfitPlan case final plan?) ...[
          const SizedBox(height: 18),
          RecommendationFeedbackCard(
            key: ValueKey('feedback-${plan.id}'),
            submitted: _submittedFeedbackPlanIds.contains(plan.id),
            onSubmit: (input) async {
              await _feedbackEventService.record(
                userId: _session.account?.id ?? 'local-demo-user',
                outfitPlanId: plan.id,
                scene: request.scene,
                satisfaction: input.satisfaction,
                rating: input.rating,
                willingToBuy: input.willingToBuy,
                noPurchaseReason: input.noPurchaseReason,
              );
              if (!mounted) {
                return;
              }
              setState(() => _submittedFeedbackPlanIds.add(plan.id));
            },
          ),
        ],
      ],
    );
  }

  Widget _buildWeatherContext() {
    final weather = _weather;
    if (weather == null) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFE3EBE1),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          const Icon(Icons.cloud_outlined, color: Color(0xFF244C3A)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${weather.city} · ${weather.temperature.round()}℃ ${weather.condition}',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 3),
                Text(
                  '最高 ${weather.high.round()}℃ / 最低 ${weather.low.round()}℃ · '
                  '湿度 ${weather.humidity.round()}% · '
                  '风力 ${weather.windSpeed.toStringAsFixed(1)} km/h',
                  style: const TextStyle(
                    color: Color(0xFF657166),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _viewModel,
      builder: (context, child) {
        final compact = MediaQuery.sizeOf(context).width < 430;
        return Scaffold(
          backgroundColor: const Color(0xffF8F7F3),
          body: SafeArea(
            child: SingleChildScrollView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: EdgeInsets.fromLTRB(
                compact ? 16 : 24,
                16,
                compact ? 16 : 24,
                48,
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 720),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 20),
                      const Text(
                        "AI 穿搭",
                        style: TextStyle(
                          fontSize: 36,
                          fontWeight: FontWeight.w800,
                          color: Colors.black87,
                        ),
                      ),
                      const SizedBox(height: 12),
                      const Text(
                        "基于你的身体比例和使用场景，生成专属穿搭建议",
                        style: TextStyle(
                          fontSize: 16,
                          height: 1.6,
                          color: Colors.black54,
                        ),
                      ),
                      const SizedBox(height: 32),
                      _buildWeatherContext(),
                      if (_weather != null) const SizedBox(height: 20),
                      _buildSceneSelector(),
                      const SizedBox(height: 28),
                      _buildBodyInfo(),
                      const SizedBox(height: 28),
                      _buildPhotoSection(),
                      const SizedBox(height: 28),
                      _buildRequestBox(),
                      const SizedBox(height: 24),
                      Semantics(
                        liveRegion: true,
                        label: _isGenerating || _viewModel.isLoading
                            ? "AI 正在分析，请稍候"
                            : "可以开始生成穿搭方案",
                        child: _buildGenerateButton(),
                      ),
                      const SizedBox(height: 40),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 360),
                        switchInCurve: Curves.easeOutCubic,
                        child: _buildResult(),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _PendingBodyPhoto {
  const _PendingBodyPhoto({required this.image, required this.bytes});

  final XFile image;
  final Uint8List bytes;
}
