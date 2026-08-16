import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/logging/app_logger.dart';
import '../components/ai_generation_loading_panel.dart';
import '../components/ai_outfit_report.dart';
import '../components/outfit_plan_card.dart';
import '../components/outfit_recommendation_card.dart';
import '../components/personal_outfit_header.dart';
import '../components/recommendation_feedback_card.dart';
import '../models/ai_recommendation_record.dart';
import '../models/app_location.dart';
import '../models/outfit.dart';
import '../models/outfit_plan.dart';
import '../models/outfit_request.dart';
import '../models/outfit_generation_state.dart';
import '../models/shopping_budget.dart';
import '../models/product.dart';
import '../models/product_loading_state.dart';
import '../models/product_analytics.dart';
import '../models/recommendation_feedback.dart';
import '../models/try_on_request.dart';
import '../models/weather_snapshot.dart';
import '../repositories/outfit_repository.dart';
import '../repositories/wardrobe_repository.dart';
import '../services/affiliate_service.dart';
import '../services/analytics_service.dart';
import '../services/backend_warmup_service.dart';
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
    this.initialGender,
    this.initialRequest,
    this.feedbackEventService,
    this.locationService,
    this.weatherService,
    this.photoStorageService,
    this.backendWarmupService,
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
  final String? initialGender;
  final String? initialRequest;
  final FeedbackEventService? feedbackEventService;
  final LocationService? locationService;
  final WeatherService? weatherService;
  final PhotoStorageService? photoStorageService;
  final BackendWarmupService? backendWarmupService;
  final ValueChanged<TryOnRequest>? onTryOn;

  @override
  State<AiOutfitPage> createState() => _AiOutfitPageState();
}

class _AiOutfitPageState extends State<AiOutfitPage> {
  final TextEditingController _heightController = TextEditingController();

  final TextEditingController _weightController = TextEditingController();

  final TextEditingController _requestController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _resultKey = GlobalKey();
  static const _sceneOptions = ['日常', '工作', '约会', '聚会', '旅行'];
  static const _photoRoleLabels = {
    'front': '正面照',
    'side': '侧面照',
    'back': '背面照',
  };
  late String _scene;
  String _itemBudget = '200-500';
  String _outfitBudget = '800-1500';

  XFile? _frontImage;

  XFile? _sideImage;

  XFile? _backImage;
  final Map<String, Uint8List> _previewBytes = {};
  final Map<String, String> _encodedImages = {};

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
  BackendWarmupService? _backendWarmupService;
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
  bool get _isLoadingProducts =>
      _viewModel.productState == ProductLoadingState.loading;
  String? get _productLoadError => _viewModel.productErrorMessage;
  bool _isRegeneratingPlan = false;
  OutfitGenerationState _generationState = OutfitGenerationState.idle;
  String _generationDetail = '';
  Timer? _stageTimer;
  int _generationSequence = 0;
  int _photoReadDurationMs = 0;
  String? _tryingOnProductId;
  WeatherSnapshot? _weather;
  AppLocation? _location;

  bool get _isGenerating => _generationState.isBusy;

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
    _backendWarmupService = widget.backendWarmupService ??
        (widget.repository == null ? BackendWarmupService() : null);
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
    _encodedImages.clear();
    _frontImage = null;
    _sideImage = null;
    _backImage = null;
    _lastRequest = null;
    _heightController.dispose();

    _weightController.dispose();

    _requestController.dispose();
    _scrollController.dispose();
    _stageTimer?.cancel();
    _backendWarmupService?.close();

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
    final readStopwatch = Stopwatch()..start();
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

    _photoReadDurationMs = readStopwatch.elapsedMilliseconds;
    AppLogger.instance.info(
      'photo_read_completed',
      metadata: {
        'durationMs': _photoReadDurationMs,
        'imageCount': candidates.length,
      },
    );

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
      _encodedImages.clear();
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
      _encodedImages.remove(role);
      if (role == 'front') _frontImage = null;
      if (role == 'side') _sideImage = null;
      if (role == 'back') _backImage = null;
    });
  }

  void _setGenerationState(
    OutfitGenerationState state, {
    String? detail,
  }) {
    if (!mounted) {
      _generationState = state;
      _generationDetail = detail ?? state.label;
      return;
    }
    setState(() {
      _generationState = state;
      _generationDetail = detail ?? state.label;
    });
  }

  void _startGenerationStageTicker() {
    _stageTimer?.cancel();
    var index = 0;
    const messages = [
      '正在分析身材与需求',
      '正在生成穿搭方案',
      '正在检查搭配细节',
      '即将完成',
    ];
    _stageTimer = Timer.periodic(const Duration(seconds: 8), (_) {
      if (!mounted ||
          _generationState != OutfitGenerationState.generatingOutfit) {
        return;
      }
      if (index < messages.length - 1) index += 1;
      setState(() => _generationDetail = messages[index]);
    });
  }

  void _stopGenerationStageTicker() {
    _stageTimer?.cancel();
    _stageTimer = null;
  }

  void _scrollToResult() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final resultContext = _resultKey.currentContext;
      if (resultContext != null) {
        Scrollable.ensureVisible(
          resultContext,
          duration: const Duration(milliseconds: 480),
          curve: Curves.easeOutCubic,
          alignment: 0.04,
        );
      }
    });
  }

  Future<void> _storePhotosWithoutBlocking(
    Map<String, String> images,
    int generationId,
  ) async {
    final stopwatch = Stopwatch()..start();
    try {
      await _photoStorageService.storePhotos(images);
      AppLogger.instance.info(
        'photo_upload_completed',
        metadata: {
          'generationId': generationId,
          'durationMs': stopwatch.elapsedMilliseconds,
          'imageCount': images.length,
        },
      );
    } catch (error, stackTrace) {
      AppLogger.instance.error(
        'photo_upload_failed',
        error: error,
        stackTrace: stackTrace,
        metadata: {
          'generationId': generationId,
          'durationMs': stopwatch.elapsedMilliseconds,
        },
      );
    }
  }

  Future<void> _generateOutfit() async {
    if (_isGenerating || _viewModel.isLoading) {
      return;
    }

    final generationId = ++_generationSequence;
    final totalStopwatch = Stopwatch()..start();
    var handedOffToProducts = false;
    _setGenerationState(OutfitGenerationState.preparingImages);
    FocusScope.of(context).unfocus();
    AppLogger.instance.info(
      'outfit_request_started',
      metadata: {
        'generationId': generationId,
        'requestStartedAt': DateTime.now().toUtc().toIso8601String(),
      },
    );

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
        _setGenerationState(OutfitGenerationState.idle);
        return;
      }

      if (!await _ensurePhotoConsent()) {
        _setGenerationState(OutfitGenerationState.idle);
        return;
      }

      if (!mounted || generationId != _generationSequence) {
        return;
      }
      _viewModel.clearResult();
      setState(() {
        _lastRequest = null;
        _selectedProductIds = {};
        _isRegeneratingPlan = false;
        _tryingOnProductId = null;
      });

      final warmupFuture = _backendWarmupService?.wake() ??
          Future.value(
            const BackendWarmupResult(durationMs: 0, isReady: true),
          );

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
      _setGenerationState(OutfitGenerationState.compressingImages);
      final imagePreparation = Stopwatch()..start();
      final canReuseEncoded = _encodedImages.length == selectedImages.length &&
          selectedImages.keys.every(_encodedImages.containsKey);
      final images = canReuseEncoded
          ? Map<String, String>.from(_encodedImages)
          : await _imageDataService.encodeImages(
              selectedImages,
              cachedBytes: selectedBytes,
            );
      if (!canReuseEncoded) {
        _encodedImages
          ..clear()
          ..addAll(images);
      }
      AppLogger.instance.info(
        'photo_preparation_completed',
        metadata: {
          'generationId': generationId,
          'readDurationMs': _photoReadDurationMs,
          'compressionDurationMs': imagePreparation.elapsedMilliseconds,
          'imageCount': images.length,
          'reusedPreparedImages': canReuseEncoded,
        },
      );
      _setGenerationState(OutfitGenerationState.uploading);
      unawaited(_storePhotosWithoutBlocking(images, generationId));
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
      await _session.ensureLoaded();
      final currentAccount = _session.account;
      final userProfile = await _profileService.load();
      final genderResolution = resolveOutfitGender(
        accountGender: currentAccount?.gender,
        profileGender: userProfile.gender,
        initialGender: widget.initialGender,
        accountIsCurrentUser: currentAccount != null,
        profileIsCurrentUser:
            currentAccount == null && widget.initialGender == null,
        initialIsCurrentFlow:
            currentAccount == null && widget.initialGender != null,
      );
      final resolvedGender = genderResolution.gender;
      final genderMetadata = <String, Object?>{
        'accountGender': genderResolution.accountGender,
        'profileGender': genderResolution.profileGender,
        'initialGender': genderResolution.initialGender,
        'resolvedGender': resolvedGender,
        'source_used': genderResolution.sourceUsed,
      };
      AppLogger.instance.info(
        'outfit_gender_resolved',
        metadata: genderMetadata,
      );
      if (genderResolution.hasConflict) {
        AppLogger.instance.warning(
          'GENDER_SOURCE_CONFLICT',
          metadata: genderMetadata,
        );
      }
      final outfitRequest = OutfitRequest(
        height: height,
        weight: weight,
        scene: _scene,
        gender: resolvedGender,
        itemBudget: _itemBudget,
        outfitBudget: _outfitBudget,
        request: userRequest,
        location: _location?.toJson() ?? const {},
        weather: _weather?.toJson() ?? const {},
        weatherConstraints: _weather == null
            ? const []
            : _weatherAdvisor.constraintsFor(_weather!),
        bodyProfile: {
          'height': height,
          'weight': weight,
          'gender': resolvedGender,
        },
        images: images,
      );
      _setGenerationState(OutfitGenerationState.wakingServer);
      final warmup = await warmupFuture;
      AppLogger.instance.info(
        'backend_warmup_completed',
        metadata: {
          'generationId': generationId,
          'durationMs': warmup.durationMs,
          'statusCode': warmup.statusCode,
          'ready': warmup.isReady,
        },
      );
      _setGenerationState(OutfitGenerationState.generatingOutfit);
      _startGenerationStageTicker();
      final aiStopwatch = Stopwatch()..start();
      final succeeded = await _viewModel.generateOutfit(outfitRequest);
      _stopGenerationStageTicker();

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
        _viewModel.beginProductLoading(_viewModel.analysis?.requestId ?? '');
        setState(() {
          _lastRequest = outfitRequest;
          _requestController.clear();
          _generationState = OutfitGenerationState.success;
          _generationDetail = OutfitGenerationState.success.label;
        });
        final aiCompletedAtMs = totalStopwatch.elapsedMilliseconds;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          AppLogger.instance.info(
            'outfit_result_rendered',
            metadata: {
              'generationId': generationId,
              'aiDurationMs': aiStopwatch.elapsedMilliseconds,
              'flutterRenderDurationMs':
                  totalStopwatch.elapsedMilliseconds - aiCompletedAtMs,
              'totalDurationMs': totalStopwatch.elapsedMilliseconds,
            },
          );
        });
        _scrollToResult();
        handedOffToProducts = true;
        unawaited(
          _loadProductRecommendations(
            outfitRequest,
            generationId: generationId,
            totalStopwatch: totalStopwatch,
          ),
        );
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
        final isTimeout = (_viewModel.errorMessage ?? '').contains('超时');
        _setGenerationState(
          isTimeout
              ? OutfitGenerationState.timeout
              : OutfitGenerationState.error,
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
      _setGenerationState(OutfitGenerationState.error);
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
      _setGenerationState(OutfitGenerationState.error);
    } finally {
      if (!handedOffToProducts) {
        _stopGenerationStageTicker();
        AppLogger.instance.info(
          'outfit_request_finished',
          metadata: {
            'generationId': generationId,
            'totalDurationMs': totalStopwatch.elapsedMilliseconds,
            'state': _generationState.name,
          },
        );
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

  Future<void> _loadProductRecommendations(
    OutfitRequest request, {
    required int generationId,
    required Stopwatch totalStopwatch,
  }) async {
    final analysis = _viewModel.analysis;

    if (analysis == null || generationId != _generationSequence) {
      return;
    }

    if (!_viewModel.beginProductLoading(analysis.requestId ?? '')) {
      return;
    }
    setState(() {
      _selectedProductIds = {};
    });

    if (analysis.hasShoppingAgentFailure) {
      _viewModel.markShoppingAgentFailure(analysis.requestId ?? '');
      setState(() {
        _generationState = OutfitGenerationState.success;
        _generationDetail = OutfitGenerationState.success.label;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('本次智能选品未完成，请重新生成')),
      );
      AppLogger.instance.warning(
        'shopping_agent_main_chain_failed',
        metadata: {
          'requestId': analysis.requestId,
          'firstFailureStage': analysis.shoppingAgentFirstFailureStage,
          'retryable': analysis.shoppingAgentRetryable,
        },
      );
      return;
    }

    final productStopwatch = Stopwatch()..start();
    late final List<Product> products;
    try {
      final catalogProducts = analysis.hasShoppingAgentResult
          ? analysis.recommendedProducts
          : analysis.productRecommendations.isNotEmpty
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
        if (!mounted || generationId != _generationSequence) {
          return;
        }
        _viewModel.attachRecommendations(
          const [],
          expectedRequestId: analysis.requestId ?? '',
          expectedGender: analysis.gender,
        );
        setState(() {
          _selectedProductIds = {};
          _generationState = OutfitGenerationState.success;
          _generationDetail = OutfitGenerationState.success.label;
        });
        AppLogger.instance.info(
          'product_recommendations_empty',
          metadata: {
            'generationId': generationId,
            'requestId': analysis.requestId,
            'durationMs': productStopwatch.elapsedMilliseconds,
          },
        );
        return;
      }

      if (!mounted || generationId != _generationSequence) {
        return;
      }

      final selectedCategories = <String>{};
      final selectedProductIds = <String>{};

      for (final product in products) {
        if (selectedCategories.add(product.wardrobeSlot)) {
          selectedProductIds.add(product.id);
        }
      }

      final attached = analysis.hasShoppingAgentResult
          ? _attachCurrentLooks(
              products: products,
              plans: analysis.outfitPlans,
              analysisRequestId: analysis.requestId ?? '',
              analysisGender: analysis.gender,
            )
          : _viewModel.attachRecommendations(
              products,
              expectedRequestId: analysis.requestId ?? '',
              expectedGender: analysis.gender,
            );
      if (!attached) {
        AppLogger.instance.warning(
          'stale_product_recommendations_ignored',
          metadata: {
            'look_request_id': analysis.requestId,
            'look_gender': analysis.gender,
          },
        );
        return;
      }
      setState(() {
        _selectedProductIds = selectedProductIds;
        _generationState = OutfitGenerationState.success;
        _generationDetail = OutfitGenerationState.success.label;
      });
      AppLogger.instance.info(
        'product_recommendations_completed',
        metadata: {
          'generationId': generationId,
          'durationMs': productStopwatch.elapsedMilliseconds,
          'productCount': products.length,
          'totalDurationMs': totalStopwatch.elapsedMilliseconds,
        },
      );
    } catch (error, stackTrace) {
      AppLogger.instance.error(
        'product_recommendations_failed',
        error: error,
        stackTrace: stackTrace,
        metadata: {'message': error.toString()},
      );
      if (!mounted || generationId != _generationSequence) {
        return;
      }

      final existingProducts =
          (_viewModel.analysis?.recommendedProducts ?? const <Product>[])
              .where((product) => !product.isMock)
              .toList(growable: false);
      final isTimeout = error.toString().contains('超时');
      _viewModel.markProductFailure(
        analysis.requestId ?? '',
        timeout: isTimeout,
        partial: existingProducts.isNotEmpty,
      );
      setState(() {
        _generationState = OutfitGenerationState.success;
        _generationDetail = OutfitGenerationState.success.label;
      });
      if (existingProducts.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('智能精选暂时不可用，AI 穿搭方案已保留')),
        );
      }
      AppLogger.instance.warning(
        'outfit_partial_success',
        metadata: {
          'generationId': generationId,
          'productDurationMs': productStopwatch.elapsedMilliseconds,
          'totalDurationMs': totalStopwatch.elapsedMilliseconds,
        },
      );
      return;
    }

    unawaited(
      _productAnalytics.recordImpressions(
        products,
        source: 'ai-outfit-recommendations',
        userId: _session.account?.id ?? 'local-demo-user',
      ),
    );

    if (analysis.hasShoppingAgentResult) {
      AppLogger.instance.info(
        'shopping_agent_products_attached',
        metadata: {
          'requestId': analysis.requestId,
          'productCount': products.length,
          'lookCount': analysis.outfitPlans.length,
        },
      );
      return;
    }

    try {
      final outfitPlans = await _productService.createOutfitPlans(
        products: products,
        analysis: analysis,
        request: request,
      );
      if (!mounted || generationId != _generationSequence) {
        return;
      }
      if (!_attachCurrentLooks(
        products: products,
        plans: outfitPlans,
        analysisRequestId: analysis.requestId ?? '',
        analysisGender: analysis.gender,
      )) {
        return;
      }
      final profile = await _profileService.load();
      if (!mounted || generationId != _generationSequence) {
        return;
      }
      final mergedProfile = await _profileService.mergeAnalysis(
        profile: profile,
        height: request.height,
        weight: request.weight,
        bodyType: analysis.bodyAnalysis,
        style: analysis.style,
        photos: request.images,
        favoriteProductIds: _favoriteService.productIds,
      );
      if (!mounted || generationId != _generationSequence) {
        return;
      }
      for (final plan in outfitPlans) {
        await _profileService.recordOutfit(mergedProfile, plan.id);
      }
      final createdTime = DateTime.now();
      try {
        for (final (index, plan) in outfitPlans.indexed) {
          await _wardrobeRepository.saveAIRecommendation(
            AIRecommendationRecord(
              id: 'ai-${createdTime.microsecondsSinceEpoch}-$index',
              scene: request.scene,
              bodyAnalysis: analysis.bodyAnalysis,
              style: analysis.style,
              outfitPlan: plan,
              createdTime: createdTime,
            ),
          );
        }
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

  void _retryProductRecommendations() {
    final request = _lastRequest;
    if (request == null || _isLoadingProducts) return;
    final generationId = ++_generationSequence;
    unawaited(
      _loadProductRecommendations(
        request,
        generationId: generationId,
        totalStopwatch: Stopwatch()..start(),
      ),
    );
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
    final generationId = _generationSequence;
    final requestId = analysis.requestId ?? '';
    final gender = analysis.gender;
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
      if (!mounted || generationId != _generationSequence) {
        return;
      }
      if (!_attachCurrentLook(
        products: analysis.recommendedProducts,
        plan: plan,
        analysisRequestId: requestId,
        analysisGender: gender,
      )) {
        return;
      }
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

  bool _attachCurrentLook({
    required List<Product> products,
    required OutfitPlan plan,
    required String analysisRequestId,
    required String analysisGender,
  }) {
    final existingPlans = _viewModel.analysis?.outfitPlans ?? const [];
    final plans = existingPlans.isEmpty
        ? <OutfitPlan>[plan]
        : existingPlans
            .map((item) => item.lookId == plan.lookId ? plan : item)
            .toList(growable: false);
    return _attachCurrentLooks(
      products: products,
      plans: plans,
      analysisRequestId: analysisRequestId,
      analysisGender: analysisGender,
    );
  }

  bool _attachCurrentLooks({
    required List<Product> products,
    required List<OutfitPlan> plans,
    required String analysisRequestId,
    required String analysisGender,
  }) {
    if (plans.isEmpty) return false;
    final attached = _viewModel.attachRecommendations(
      products,
      outfitPlan: plans.first,
      outfitPlans: plans,
      expectedRequestId: analysisRequestId,
      expectedGender: analysisGender,
    );
    if (!attached) {
      AppLogger.instance.warning(
        'stale_or_gender_mismatched_look_ignored',
        metadata: {
          'look_request_id': plans.first.requestId,
          'look_gender': plans.first.gender,
          'expected_request_id': analysisRequestId,
          'expected_gender': analysisGender,
        },
      );
      return false;
    }
    for (final plan in plans) {
      for (final product in plan.products) {
        AppLogger.instance.info(
          'look_image_selected',
          metadata: {
            'look_request_id': plan.requestId,
            'look_id': plan.lookId,
            'look_gender': plan.gender,
            'look_style': plan.style,
            'look_scene': plan.scene,
            'image_source': product.imageUrl.isEmpty
                ? 'placeholder'
                : product.sourceProvider,
            'product_id': product.id,
          },
        );
      }
    }
    return true;
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
      key: const Key('ai-body-info'),
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

  Widget _buildBudgetSelector() {
    return Container(
      key: const Key('ai-request-budget'),
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '本次预算',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          const Text(
            '仅用于本次 Look 与商品推荐，不会保存到个人资料。',
            style: TextStyle(color: Colors.black54, height: 1.4),
          ),
          const SizedBox(height: 16),
          const Text('单品预算', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final option in itemBudgetOptions)
                ChoiceChip(
                  key: Key('ai-item-budget-$option'),
                  label: Text(option),
                  selected: _itemBudget == option,
                  onSelected: _isGenerating
                      ? null
                      : (_) => setState(() => _itemBudget = option),
                ),
            ],
          ),
          const SizedBox(height: 16),
          const Text('整套预算', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final option in outfitBudgetOptions)
                ChoiceChip(
                  key: Key('ai-outfit-budget-$option'),
                  label: Text(option),
                  selected: _outfitBudget == option,
                  onSelected: _isGenerating
                      ? null
                      : (_) => setState(() => _outfitBudget = option),
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
      key: const Key('ai-photo-scan'),
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
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (isBusy) ...[
              const SizedBox(
                width: 19,
                height: 19,
                child: CircularProgressIndicator(
                  key: Key('generate-button-spinner'),
                  strokeWidth: 2.2,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 10),
            ],
            Flexible(
              child: Text(
                isBusy ? _generationState.label : '✦ 生成我的穿搭方案',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 16,
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGenerationFeedback() {
    if (_generationState.isBusy &&
        _generationState != OutfitGenerationState.loadingProducts) {
      return AiGenerationLoadingPanel(
        key: ValueKey(_generationState),
        state: _generationState,
        detailMessage: _generationDetail,
      );
    }
    if (_generationState == OutfitGenerationState.timeout ||
        _generationState == OutfitGenerationState.error) {
      return Container(
        key: Key('generation-${_generationState.name}'),
        width: double.infinity,
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF6ED),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFE5CDB7)),
        ),
        child: Column(
          children: [
            Text(
              _generationState.label,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF7B4E35),
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              key: const Key('retry-outfit-generation'),
              onPressed: _generateOutfit,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('重新生成'),
            ),
          ],
        ),
      );
    }
    return const SizedBox.shrink();
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
    final visiblePlans = analysis.outfitPlans
        .where(
          (plan) => plan.matchesCurrentResult(
            requestId: analysis.requestId ?? '',
            gender: analysis.gender,
          ),
        )
        .toList(growable: false);
    final currentPlan = analysis.outfitPlan;
    final visiblePlan = visiblePlans.isNotEmpty
        ? visiblePlans.first
        : currentPlan != null &&
                currentPlan.matchesCurrentResult(
                  requestId: analysis.requestId ?? '',
                  gender: analysis.gender,
                )
            ? currentPlan
            : null;
    final allVisiblePlans = visiblePlans.isNotEmpty
        ? visiblePlans
        : visiblePlan == null
            ? const <OutfitPlan>[]
            : <OutfitPlan>[visiblePlan];

    return Container(
      key: _resultKey,
      child: Column(
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
          if (visiblePlan case final primaryPlan?) ...[
            const Text(
              '今日推荐 Look',
              style: TextStyle(
                color: Color(0xFF211F1C),
                fontSize: 21,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 12),
            for (final (index, plan) in allVisiblePlans.indexed) ...[
              Text(
                'Look ${index + 1} · ${plan.style}',
                style: const TextStyle(
                  color: Color(0xFF48423C),
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              OutfitPlanCard(
                plan: plan,
                favorite: _favoriteService.isOutfitPlanFavorite(plan.id),
                onFavorite: _toggleFavoritePlan,
                onTryOn: widget.onTryOn == null ? null : _openVirtualTryOn,
                onProductTap: _showProductDetails,
                onReplaceCategory: index == 0 ? _replacePlanProduct : null,
                onRegenerate: index == 0 ? _regenerateOutfitPlan : null,
                isRegenerating: index == 0 && _isRegeneratingPlan,
                isTryOnLoading: _tryingOnProductId != null,
              ),
              const SizedBox(height: 14),
            ],
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
                      properties: {'outfitPlanId': primaryPlan.id},
                    ),
                  );
                  showShareOutfitSheet(
                    context,
                    outfitPlan: primaryPlan,
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
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 320),
            child: OutfitRecommendationCard(
              key: ValueKey(
                _isLoadingProducts ? 'product-loading' : 'product-content',
              ),
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
              onRetry:
                  _lastRequest == null ? null : _retryProductRecommendations,
              tryingOnProductId: _tryingOnProductId,
            ),
          ),
          if (visiblePlan case final plan?) ...[
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
      ),
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
              controller: _scrollController,
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
                      _buildBudgetSelector(),
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
                      const SizedBox(height: 16),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 240),
                        child: _buildGenerationFeedback(),
                      ),
                      const SizedBox(height: 24),
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
