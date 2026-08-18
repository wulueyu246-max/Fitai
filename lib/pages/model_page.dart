import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../components/model_action_bar.dart';
import '../components/body_parameter_panel.dart';
import '../components/outfit_swap_carousel.dart';
import '../components/virtual_model_view.dart';
import '../features/share/widgets/share_outfit_sheet.dart';
import '../models/product.dart';
import '../models/product_analytics.dart';
import '../models/outfit_plan.dart';
import '../models/try_on_request.dart';
import '../models/try_on_record.dart';
import '../models/try_on_result.dart';
import '../models/try_on_status.dart';
import '../models/virtual_model.dart';
import '../models/virtual_body_parameters.dart';
import '../models/virtual_model_3d_scene.dart';
import '../repositories/virtual_try_on_repository.dart';
import '../repositories/wardrobe_repository.dart';
import '../services/affiliate_service.dart';
import '../services/analytics_service.dart';
import '../services/favorite_service.dart';
import '../services/product_service.dart';
import '../services/product_analytics_service.dart';
import '../services/recommendation_feedback_service.dart';
import '../services/user_profile_service.dart';
import '../services/virtual_try_on_service.dart';
import '../services/virtual_try_on_api.dart';
import '../services/virtual_model_3d_service.dart';
import '../models/recommendation_feedback.dart';
import 'product_detail_page.dart';

class ModelPage extends StatelessWidget {
  const ModelPage({
    this.tryOnListenable,
    this.productService,
    this.tryOnService,
    this.tryOnRepository,
    this.wardrobeRepository,
    this.model3DService,
    this.affiliateService,
    this.analyticsService,
    this.onBack,
    super.key,
  });

  final ValueListenable<TryOnRequest?>? tryOnListenable;
  final ProductService? productService;
  final VirtualTryOnService? tryOnService;
  final VirtualTryOnRepository? tryOnRepository;
  final WardrobeRepository? wardrobeRepository;
  final VirtualModel3DService? model3DService;
  final AffiliateService? affiliateService;
  final AnalyticsService? analyticsService;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final listenable = tryOnListenable;

    if (listenable == null) {
      return _EmptyModelState(onBack: onBack);
    }

    return ValueListenableBuilder<TryOnRequest?>(
      valueListenable: listenable,
      builder: (context, request, child) {
        if (request == null) {
          return _EmptyModelState(onBack: onBack);
        }

        return _VirtualModelWorkspace(
          key: ObjectKey(request),
          request: request,
          productService: productService ?? const MockProductService(),
          tryOnService: tryOnService ?? const MockVirtualTryOnService(),
          tryOnRepository: tryOnRepository ??
              PollingVirtualTryOnRepository(
                api: ServiceBackedVirtualTryOnAPI(
                  tryOnService ?? const MockVirtualTryOnService(),
                ),
              ),
          wardrobeRepository: wardrobeRepository ?? LocalWardrobeRepository(),
          model3DService: model3DService ?? const MockVirtualModel3DService(),
          affiliateService: affiliateService ?? LocalAffiliateService(),
          analyticsService: analyticsService ?? LocalAnalyticsService.instance,
          onBack: onBack,
        );
      },
    );
  }
}

class _VirtualModelWorkspace extends StatefulWidget {
  const _VirtualModelWorkspace({
    required this.request,
    required this.productService,
    required this.tryOnService,
    required this.tryOnRepository,
    required this.wardrobeRepository,
    required this.model3DService,
    required this.affiliateService,
    required this.analyticsService,
    this.onBack,
    super.key,
  });

  final TryOnRequest request;
  final ProductService productService;
  final VirtualTryOnService tryOnService;
  final VirtualTryOnRepository tryOnRepository;
  final WardrobeRepository wardrobeRepository;
  final VirtualModel3DService model3DService;
  final AffiliateService affiliateService;
  final AnalyticsService analyticsService;
  final VoidCallback? onBack;

  @override
  State<_VirtualModelWorkspace> createState() => _VirtualModelWorkspaceState();
}

class _VirtualModelWorkspaceState extends State<_VirtualModelWorkspace> {
  VirtualModel? _model;
  VirtualModel3DScene? _model3DScene;
  late VirtualBodyParameters _bodyParameters;
  VirtualModelViewAngle _viewAngle = VirtualModelViewAngle.front;
  late Product _focusedProduct;
  late OutfitPlan _outfitPlan;
  final FavoriteService _favoriteService = FavoriteService.instance;
  final RecommendationFeedbackService _feedbackService =
      RecommendationFeedbackService.instance;
  final UserProfileService _profileService = UserProfileService();
  final ProductAnalyticsService _productAnalytics =
      ProductAnalyticsService.instance;
  List<Product> _catalog = const [];
  String _activeCategory = ProductCategory.top;
  String? _updatingProductId;
  String? _errorMessage;
  TryOnStatus _tryOnStatus = TryOnStatus.idle;
  TryOnResult? _tryOnResult;
  String? _tryOnError;
  bool _isOutfitSaved = false;
  bool _isTryOnResultSaved = false;
  bool _isSavingTryOnResult = false;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _focusedProduct = widget.request.product;
    _outfitPlan = widget.request.outfitPlan;
    _bodyParameters = VirtualBodyParameters(
      height: widget.request.virtualModel.outfit.height,
      weight: widget.request.virtualModel.outfit.weight,
    );
    _loadModel();
  }

  Future<void> _loadModel() async {
    try {
      final catalog = await widget.productService.getCatalog();
      await _favoriteService.ensureLoaded();
      final scene = await widget.model3DService.createScene(
        model: widget.request.virtualModel,
        bodyParameters: _bodyParameters,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _model = widget.request.virtualModel;
        _model3DScene = scene;
        _catalog = catalog;
        _isLoading = false;
        _errorMessage = null;
        _isOutfitSaved = _favoriteService.isOutfitPlanFavorite(_outfitPlan.id);
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoading = false;
        _errorMessage = 'AI 模特加载失败，请稍后重试';
      });
    }
  }

  Future<void> _tryOn(Product product) async {
    final model = _model;

    if (model == null ||
        _updatingProductId != null ||
        model.outfit.productForCategory(product.wardrobeSlot)?.id ==
            product.id) {
      return;
    }

    setState(() {
      _updatingProductId = product.id;
    });

    try {
      final updatedModel = await widget.tryOnService.tryOn(
        model: model,
        product: product,
      );
      final currentScene = _model3DScene;
      final updatedScene = currentScene == null
          ? null
          : await widget.model3DService.updateGarments(
              currentScene,
              updatedModel.outfit.products,
            );

      if (!mounted) {
        return;
      }

      setState(() {
        _model = updatedModel;
        _model3DScene = updatedScene ?? _model3DScene;
        _focusedProduct = product;
        _outfitPlan = _outfitPlan.replaceProduct(product);
        _updatingProductId = null;
        _tryOnStatus = TryOnStatus.idle;
        _tryOnResult = null;
        _tryOnError = null;
        _isTryOnResultSaved = false;
        _isOutfitSaved = false;
      });
      await _feedbackService.record(
        action: RecommendationFeedbackAction.tryOn,
        productId: product.id,
        outfitPlanId: _outfitPlan.id,
        source: 'virtual-model-swap',
      );
      await _productAnalytics.record(
        action: ProductAnalyticsAction.tryOn,
        product: product,
        source: 'virtual-model-swap',
        userId: widget.request.userId,
      );
      final profile = await _profileService.load(userId: widget.request.userId);
      await _profileService.recordTryOn(
        profile,
        product.id,
        userId: widget.request.userId,
      );
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _updatingProductId = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('更换单品失败，请稍后重试')),
      );
    }
  }

  Future<void> _swapProduct() async {
    final alternatives = _catalog
        .where(
          (product) =>
              product.wardrobeSlot == _focusedProduct.wardrobeSlot &&
              product.id != _focusedProduct.id,
        )
        .toList();
    if (alternatives.isEmpty) {
      _showMessage('当前分类暂时没有更多商品');
      return;
    }
    final currentIndex =
        alternatives.indexWhere((product) => product.id == _focusedProduct.id);
    final next = alternatives[(currentIndex + 1) % alternatives.length];
    await _tryOn(next);
  }

  Future<void> _changeColor() async {
    final alternatives = _catalog
        .where(
          (product) =>
              product.wardrobeSlot == _focusedProduct.wardrobeSlot &&
              product.color != _focusedProduct.color,
        )
        .toList();
    if (alternatives.isEmpty) {
      _showMessage('当前商品暂时没有其他颜色');
      return;
    }
    await _tryOn(alternatives.first);
  }

  Future<void> _setViewAngle(VirtualModelViewAngle angle) async {
    if (_viewAngle == angle) {
      return;
    }
    setState(() => _viewAngle = angle);
    final scene = _model3DScene;
    if (scene == null) {
      return;
    }
    try {
      final updated = await widget.model3DService.setViewAngle(scene, angle);
      if (mounted && _viewAngle == angle) {
        setState(() => _model3DScene = updated);
      }
    } catch (_) {
      // The local viewport remains interactive if a future 3D engine is down.
    }
  }

  Future<void> _updateBodyParameters(
    VirtualBodyParameters parameters,
  ) async {
    setState(() => _bodyParameters = parameters);
    final scene = _model3DScene;
    if (scene == null) {
      return;
    }
    try {
      final updated = await widget.model3DService.updateBody(scene, parameters);
      if (mounted && identical(_bodyParameters, parameters)) {
        setState(() => _model3DScene = updated);
      }
    } catch (_) {
      // Keep the last local body preview and allow the next adjustment to retry.
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  Future<void> _toggleSaveOutfit() async {
    try {
      final saved =
          await widget.wardrobeRepository.toggleOutfitPlan(_outfitPlan);
      if (saved) {
        await widget.analyticsService.track(
          'outfit_plan_favorited',
          userId: widget.request.userId,
          properties: {
            'outfitPlanId': _outfitPlan.id,
            'source': 'virtual-model-page',
          },
        );
      }
      if (!mounted) {
        return;
      }
      setState(() => _isOutfitSaved = saved);
      _showMessage(saved ? '当前穿搭方案已收藏' : '已取消收藏当前搭配');
    } catch (_) {
      if (mounted) {
        _showMessage('保存搭配失败，请检查网络后重试');
      }
    }
  }

  Future<void> _shareOutfit() async {
    try {
      await showShareOutfitSheet(
        context,
        outfitPlan: _outfitPlan,
        tryOnImage: _tryOnResult?.image,
      );
      await widget.analyticsService.track(
        'try_on_result_shared',
        userId: widget.request.userId,
        properties: {
          'outfitPlanId': _outfitPlan.id,
          'productId': _focusedProduct.id,
          'hasResult': (_tryOnResult != null).toString(),
        },
      );
    } catch (_) {
      if (mounted) {
        _showMessage('分享内容生成失败，请稍后重试');
      }
    }
  }

  Future<void> _saveTryOnResult() async {
    final result = _tryOnResult;
    if (result == null || _isTryOnResultSaved || _isSavingTryOnResult) {
      return;
    }
    setState(() => _isSavingTryOnResult = true);
    try {
      await widget.wardrobeRepository.saveTryOnRecord(
        TryOnRecord(
          id: result.id,
          userId: widget.request.userId,
          imageUrl: result.image,
          outfitPlan: _outfitPlan,
          createdTime: result.createdTime,
          isMock: result.isMock,
        ),
      );
      await widget.analyticsService.track(
        'try_on_result_saved',
        userId: widget.request.userId,
        properties: {
          'outfitPlanId': _outfitPlan.id,
          'productId': _focusedProduct.id,
          'isMock': result.isMock.toString(),
        },
      );
      if (!mounted) {
        return;
      }
      setState(() => _isTryOnResultSaved = true);
      _showMessage('试穿结果已保存到我的衣橱');
    } catch (_) {
      if (mounted) {
        _showMessage('保存试穿结果失败，请检查网络后重试');
      }
    } finally {
      if (mounted) {
        setState(() => _isSavingTryOnResult = false);
      }
    }
  }

  Future<void> _openProductDetails() async {
    try {
      await widget.affiliateService.recordProductClick(
        product: _focusedProduct,
        source: 'virtual-model-page',
        userId: widget.request.userId,
      );
      if (!mounted) {
        return;
      }
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (context) => ProductDetailPage(
            product: _focusedProduct,
            userId: widget.request.userId,
            affiliateService: widget.affiliateService,
            analyticsService: widget.analyticsService,
            trackOpen: false,
            onFavorite: (product) async {
              final selected =
                  await widget.wardrobeRepository.toggleProduct(product);
              if (selected) {
                await _productAnalytics.record(
                  action: ProductAnalyticsAction.favorite,
                  product: product,
                  source: 'virtual-model-product-detail',
                  userId: widget.request.userId,
                );
              }
            },
          ),
        ),
      );
    } catch (_) {
      if (mounted) {
        _showMessage('商品详情加载失败，请检查网络后重试');
      }
    }
  }

  Future<void> _buyFocusedProduct() async {
    try {
      await widget.analyticsService.track(
        'purchase_intent',
        userId: widget.request.userId,
        properties: {
          'productId': _focusedProduct.id,
          'sku': _focusedProduct.sku,
          'source': 'virtual-model-page',
        },
      );
      await widget.affiliateService.openPurchase(
        product: _focusedProduct,
        source: 'virtual-model-page',
        userId: widget.request.userId,
      );
      if (mounted) {
        _showMessage('已打开品牌购买页面');
      }
    } catch (_) {
      if (mounted) {
        _showMessage('购买页面打开失败，请检查网络后重试');
      }
    }
  }

  Future<void> _generateTryOn() async {
    final model = _model;

    if (model == null ||
        _tryOnStatus == TryOnStatus.waiting ||
        _tryOnStatus == TryOnStatus.generating) {
      return;
    }

    final request = widget.request.copyWith(
      virtualModel: model,
      products: List<Product>.unmodifiable(model.outfit.products),
      outfitPlan: _outfitPlan,
      createdTime: DateTime.now(),
    );

    setState(() {
      _tryOnStatus = TryOnStatus.waiting;
      _tryOnResult = null;
      _tryOnError = null;
      _isTryOnResultSaved = false;
    });

    try {
      await Future<void>.delayed(const Duration(milliseconds: 220));
      if (!mounted) {
        return;
      }
      setState(() => _tryOnStatus = TryOnStatus.generating);
      final result = await widget.tryOnRepository.generateAndWait(request);

      if (!mounted) {
        return;
      }

      setState(() {
        _tryOnStatus = TryOnStatus.success;
        _tryOnResult = result;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _tryOnStatus = TryOnStatus.failed;
        _tryOnError = '试穿效果生成失败，请稍后重试';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F6F3),
      body: SafeArea(
        child: _isLoading
            ? const _LoadingModelState()
            : _errorMessage != null
                ? _ErrorModelState(
                    message: _errorMessage!,
                    onRetry: () {
                      setState(() {
                        _isLoading = true;
                        _errorMessage = null;
                      });
                      _loadModel();
                    },
                  )
                : _buildContent(_model!),
      ),
    );
  }

  Widget _buildContent(VirtualModel model) {
    final visibleProducts = _catalog
        .where((product) => product.wardrobeSlot == _activeCategory)
        .toList();

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 48),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  IconButton(
                    key: const Key('model-back-button'),
                    tooltip: '返回 AI穿搭',
                    onPressed:
                        widget.onBack ?? () => Navigator.maybePop(context),
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: const Color(0xFF292624),
                      side: const BorderSide(color: Color(0xFFE8E4DE)),
                    ),
                    icon: const Icon(Icons.arrow_back_rounded),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text(
                      '我的AI模特',
                      style: TextStyle(
                        color: Color(0xFF1B1A18),
                        fontSize: 31,
                        letterSpacing: -0.7,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.only(left: 60),
                child: Text(
                  '${_bodyParameters.height.toStringAsFixed(0)}cm · '
                  '${_bodyParameters.weight.toStringAsFixed(0)}kg · '
                  '${model.outfit.style}',
                  style: const TextStyle(
                    color: Color(0xFF77716C),
                    fontSize: 13.5,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const _TryOnGuideCard(),
              const SizedBox(height: 22),
              const Text(
                '我的数字人',
                style: TextStyle(
                  color: Color(0xFF1E1C1A),
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 12),
              VirtualModelView(
                model: model,
                isUpdating: _updatingProductId != null,
                bodyParameters: _bodyParameters,
                viewAngle: _viewAngle,
                onViewAngleChanged: _setViewAngle,
              ),
              const SizedBox(height: 12),
              BodyParameterPanel(
                parameters: _bodyParameters,
                onChanged: _updateBodyParameters,
              ),
              const SizedBox(height: 22),
              _SelectedTryOnProductCard(
                product: _focusedProduct,
                outfitPlan: _outfitPlan,
                onViewDetails: _openProductDetails,
                onBuy: _buyFocusedProduct,
              ),
              const SizedBox(height: 14),
              ModelActionBar(
                onRegenerate: _generateTryOn,
                onChangeProduct: _swapProduct,
                onChangeColor: _changeColor,
                onSave: _toggleSaveOutfit,
                onShare: _shareOutfit,
                saved: _isOutfitSaved,
                generating: _tryOnStatus == TryOnStatus.waiting ||
                    _tryOnStatus == TryOnStatus.generating,
              ),
              const SizedBox(height: 18),
              const Text(
                '试穿效果',
                style: TextStyle(
                  color: Color(0xFF1E1C1A),
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 12),
              _TryOnGenerationCard(
                status: _tryOnStatus,
                result: _tryOnResult,
                errorMessage: _tryOnError,
                onGenerate: _generateTryOn,
                onSave: _saveTryOnResult,
                onShare: _shareOutfit,
                resultSaved: _isTryOnResultSaved,
                savingResult: _isSavingTryOnResult,
              ),
              const SizedBox(height: 32),
              const Text(
                '当前穿搭方案',
                style: TextStyle(
                  color: Color(0xFF1E1C1A),
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                '点击当前类别，再从下方选择商品进行替换',
                style: TextStyle(
                  color: Color(0xFF817B75),
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 15),
              for (final category in const [
                ProductCategory.top,
                ProductCategory.bottom,
                ProductCategory.shoes,
              ])
                _CurrentOutfitTile(
                  category: category,
                  product: model.outfit.productForCategory(category),
                  active: _activeCategory == category,
                  onTap: () {
                    setState(() {
                      _activeCategory = category;
                    });
                  },
                ),
              const SizedBox(height: 28),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '更换$_activeCategory',
                      style: const TextStyle(
                        color: Color(0xFF1E1C1A),
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const Text(
                    '左右滑动即可换装',
                    style: TextStyle(
                      color: Color(0xFF796B86),
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              OutfitSwapCarousel(
                key: ValueKey('swap-$_activeCategory'),
                products: visibleProducts,
                selectedProductId:
                    model.outfit.productForCategory(_activeCategory)?.id,
                onSelected: _tryOn,
              ),
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFEDE9F0),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.info_outline_rounded,
                      size: 18,
                      color: Color(0xFF685975),
                    ),
                    SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        '当前为 Mock 3D 交互框架，可调整身材、切换衣服并拖动查看背面；暂不代表真实面料与尺寸效果。',
                        style: TextStyle(
                          color: Color(0xFF5D5364),
                          fontSize: 12,
                          height: 1.5,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TryOnGuideCard extends StatelessWidget {
  const _TryOnGuideCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('virtual-try-on-guide'),
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFEEE8F3), Color(0xFFF8F5F0)],
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '3D 试穿使用指南',
            style: TextStyle(
              color: Color(0xFF302A34),
              fontSize: 15,
              fontWeight: FontWeight.w900,
            ),
          ),
          SizedBox(height: 9),
          Text(
            '拖动人物查看正面与背面 · 左右滑动切换商品 · 调整身材参数后生成试穿效果',
            style: TextStyle(
              color: Color(0xFF655E68),
              fontSize: 12.5,
              height: 1.55,
            ),
          ),
        ],
      ),
    );
  }
}

class _TryOnGenerationCard extends StatelessWidget {
  const _TryOnGenerationCard({
    required this.status,
    required this.result,
    required this.errorMessage,
    required this.onGenerate,
    required this.onSave,
    required this.onShare,
    required this.resultSaved,
    required this.savingResult,
  });

  final TryOnStatus status;
  final TryOnResult? result;
  final String? errorMessage;
  final VoidCallback onGenerate;
  final VoidCallback onSave;
  final VoidCallback onShare;
  final bool resultSaved;
  final bool savingResult;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 240),
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE9E5DF)),
      ),
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 220),
        child: switch (status) {
          TryOnStatus.idle => _IdleTryOnState(onGenerate: onGenerate),
          TryOnStatus.waiting => const _WaitingTryOnState(),
          TryOnStatus.generating => const _GeneratingTryOnState(),
          TryOnStatus.success => _SuccessTryOnState(
              result: result!,
              onGenerate: onGenerate,
              onSave: onSave,
              onShare: onShare,
              resultSaved: resultSaved,
              savingResult: savingResult,
            ),
          TryOnStatus.failed => _FailedTryOnState(
              message: errorMessage ?? '试穿效果生成失败',
              onRetry: onGenerate,
            ),
        },
      ),
    );
  }
}

class _IdleTryOnState extends StatelessWidget {
  const _IdleTryOnState({required this.onGenerate});

  final VoidCallback onGenerate;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey(TryOnStatus.idle),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          '生成模拟试穿效果',
          style: TextStyle(
            color: Color(0xFF1F1D1B),
            fontSize: 18,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 7),
        const Text(
          '根据当前虚拟模特与所选商品，生成一张 Mock 整体穿搭效果图。',
          style: TextStyle(
            color: Color(0xFF716B66),
            fontSize: 13,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 15),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            key: const Key('generate-try-on-button'),
            onPressed: onGenerate,
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF1C1A1E),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
            icon: const Icon(Icons.auto_awesome_rounded, size: 18),
            label: const Text(
              '生成试穿效果',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ),
      ],
    );
  }
}

class _WaitingTryOnState extends StatelessWidget {
  const _WaitingTryOnState();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      key: ValueKey(TryOnStatus.waiting),
      height: 176,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.schedule_rounded, size: 38, color: Color(0xFF695777)),
            SizedBox(height: 18),
            Text(
              '试穿任务已进入队列',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
            SizedBox(height: 7),
            Text('正在准备用户照片、数字模特与商品数据'),
          ],
        ),
      ),
    );
  }
}

class _GeneratingTryOnState extends StatelessWidget {
  const _GeneratingTryOnState();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      key: ValueKey(TryOnStatus.generating),
      height: 176,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 38,
              height: 38,
              child: CircularProgressIndicator(strokeWidth: 3),
            ),
            SizedBox(height: 18),
            Text(
              '正在生成试穿效果...',
              style: TextStyle(
                color: Color(0xFF282427),
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
            SizedBox(height: 7),
            Text(
              'Mock 模型正在合成虚拟人物与当前商品',
              style: TextStyle(
                color: Color(0xFF77716C),
                fontSize: 12.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SuccessTryOnState extends StatelessWidget {
  const _SuccessTryOnState({
    required this.result,
    required this.onGenerate,
    required this.onSave,
    required this.onShare,
    required this.resultSaved,
    required this.savingResult,
  });

  final TryOnResult result;
  final VoidCallback onGenerate;
  final VoidCallback onSave;
  final VoidCallback onShare;
  final bool resultSaved;
  final bool savingResult;

  @override
  Widget build(BuildContext context) {
    final resultImage = result.isNetworkImage
        ? Image.network(
            result.image,
            key: const Key('try-on-result-image'),
            fit: BoxFit.cover,
            loadingBuilder: (context, child, progress) => progress == null
                ? child
                : const Center(child: CircularProgressIndicator()),
            errorBuilder: (context, error, stackTrace) =>
                const _TryOnImageFailure(),
          )
        : Image.asset(
            result.image,
            key: const Key('try-on-result-image'),
            fit: BoxFit.cover,
            cacheWidth: 900,
            errorBuilder: (context, error, stackTrace) =>
                const _TryOnImageFailure(),
          );

    return Column(
      key: const ValueKey(TryOnStatus.success),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                '试穿生成结果',
                style: TextStyle(
                  color: Color(0xFF1F1D1B),
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            if (result.isMock)
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 9,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFEDE8F1),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Text(
                  'Mock 结果',
                  style: TextStyle(
                    color: Color(0xFF665774),
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 14),
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: AspectRatio(
              aspectRatio: 2 / 3,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: resultImage,
              ),
            ),
          ),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: FilledButton.tonalIcon(
                key: const Key('save-try-on-result'),
                onPressed: resultSaved || savingResult ? null : onSave,
                icon: savingResult
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(
                        resultSaved
                            ? Icons.check_circle_rounded
                            : Icons.bookmark_add_outlined,
                        size: 18,
                      ),
                label: Text(resultSaved ? '已保存' : '保存结果'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: FilledButton.tonalIcon(
                key: const Key('share-try-on-result'),
                onPressed: onShare,
                icon: const Icon(Icons.ios_share_rounded, size: 18),
                label: const Text('分享结果'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            key: const Key('regenerate-try-on-button'),
            onPressed: onGenerate,
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('重新生成'),
          ),
        ),
      ],
    );
  }
}

class _TryOnImageFailure extends StatelessWidget {
  const _TryOnImageFailure();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFFF0ECE7),
      alignment: Alignment.center,
      padding: const EdgeInsets.all(24),
      child: const Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.broken_image_outlined, color: Color(0xFF8A817A)),
          SizedBox(height: 8),
          Text(
            '试穿图片加载失败\n请检查网络后重新生成',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFF6F6862), height: 1.45),
          ),
        ],
      ),
    );
  }
}

class _FailedTryOnState extends StatelessWidget {
  const _FailedTryOnState({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey(TryOnStatus.failed),
      children: [
        const Icon(
          Icons.error_outline_rounded,
          size: 38,
          color: Color(0xFF9E4F4F),
        ),
        const SizedBox(height: 12),
        Text(message),
        const SizedBox(height: 14),
        FilledButton(
          key: const Key('retry-try-on-button'),
          onPressed: onRetry,
          child: const Text('重新生成'),
        ),
      ],
    );
  }
}

class _SelectedTryOnProductCard extends StatelessWidget {
  const _SelectedTryOnProductCard({
    required this.product,
    required this.outfitPlan,
    required this.onViewDetails,
    required this.onBuy,
  });

  final Product product;
  final OutfitPlan outfitPlan;
  final VoidCallback onViewDetails;
  final VoidCallback onBuy;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('selected-try-on-product'),
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE9E5DF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '当前选择商品',
            style: TextStyle(
              color: Color(0xFF1F1D1B),
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 14),
          Text(
            outfitPlan.title,
            style: const TextStyle(
              color: Color(0xFF695A78),
              fontSize: 12.5,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: _ProductThumbnail(
                  product: product,
                  width: 82,
                  height: 98,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.brand,
                      style: const TextStyle(
                        color: Color(0xFF796A86),
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      product.name,
                      style: const TextStyle(
                        color: Color(0xFF24211F),
                        fontSize: 15,
                        height: 1.35,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${product.color} · ${product.displayPrice}',
                      style: const TextStyle(
                        color: Color(0xFF6F6963),
                        fontSize: 12.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Text(
            '穿搭说明',
            style: TextStyle(
              color: Color(0xFF695A78),
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            '${outfitPlan.reason}\n\n当前单品：${product.aiReason}',
            style: const TextStyle(
              color: Color(0xFF55504B),
              fontSize: 13,
              height: 1.55,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: const Key('model-view-product-detail'),
                  onPressed: onViewDetails,
                  child: const Text('查看商品'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  key: const Key('model-buy-product'),
                  onPressed: onBuy,
                  icon: const Icon(Icons.shopping_bag_outlined, size: 18),
                  label: const Text('立即购买'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ProductThumbnail extends StatelessWidget {
  const _ProductThumbnail({
    required this.product,
    required this.width,
    required this.height,
  });

  final Product product;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    Widget fallback(BuildContext context, Object error, StackTrace? stack) {
      return Container(
        width: width,
        height: height,
        color: const Color(0xFFF0ECE7),
        alignment: Alignment.center,
        child: const Icon(
          Icons.checkroom_outlined,
          color: Color(0xFF8A817A),
        ),
      );
    }

    return product.isNetworkImage
        ? Image.network(
            product.imageUrl,
            width: width,
            height: height,
            fit: BoxFit.cover,
            errorBuilder: fallback,
          )
        : Image.asset(
            product.imageUrl,
            width: width,
            height: height,
            fit: BoxFit.cover,
            cacheWidth: (width * 3).round(),
            errorBuilder: fallback,
          );
  }
}

class _CurrentOutfitTile extends StatelessWidget {
  const _CurrentOutfitTile({
    required this.category,
    required this.product,
    required this.active,
    required this.onTap,
  });

  final String category;
  final Product? product;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: active ? const Color(0xFFF0EDF3) : Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color:
                    active ? const Color(0xFF7A6A87) : const Color(0xFFEAE7E2),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: const Color(0xFFF4F1ED),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: product == null
                      ? const Icon(
                          Icons.add_rounded,
                          color: Color(0xFF8A837C),
                        )
                      : _ProductThumbnail(
                          product: product!,
                          width: 48,
                          height: 48,
                        ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  width: 48,
                  child: Text(
                    category,
                    style: const TextStyle(
                      color: Color(0xFF766F69),
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Expanded(
                  child: Text(
                    product?.name ?? '选择一件商品',
                    style: const TextStyle(
                      color: Color(0xFF252321),
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  active
                      ? Icons.keyboard_arrow_down_rounded
                      : Icons.chevron_right_rounded,
                  color: const Color(0xFF7A7180),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyModelState extends StatelessWidget {
  const _EmptyModelState({this.onBack});

  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 28),
      child: Column(
        children: [
          Row(
            children: [
              IconButton(
                key: const Key('model-back-button'),
                tooltip: '返回 AI穿搭',
                onPressed: onBack ?? () => Navigator.maybePop(context),
                style: IconButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: const Color(0xFF292624),
                  side: const BorderSide(color: Color(0xFFE8E4DE)),
                ),
                icon: const Icon(Icons.arrow_back_rounded),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  '我的AI模特',
                  style: TextStyle(
                    color: Color(0xFF1F1D1B),
                    fontSize: 26,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          Expanded(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      width: 92,
                      height: 92,
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            Color(0xFFE8E2ED),
                            Color(0xFFDCEAE6),
                          ],
                        ),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.accessibility_new_rounded,
                        size: 46,
                        color: Color(0xFF665774),
                      ),
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      '还没有试穿方案',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Color(0xFF1F1D1B),
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      '请先在 AI穿搭 页面上传照片并生成方案，然后点击商品卡片中的“立即试穿”。',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Color(0xFF77716C),
                        fontSize: 14,
                        height: 1.55,
                      ),
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      key: const Key('model-start-photo-upload'),
                      onPressed: onBack ?? () => Navigator.maybePop(context),
                      icon: const Icon(Icons.add_a_photo_outlined),
                      label: const Text('上传照片并开始'),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 22,
                          vertical: 14,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LoadingModelState extends StatelessWidget {
  const _LoadingModelState();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(strokeWidth: 2.5),
          SizedBox(height: 18),
          Text(
            '正在加载你的 AI 模特...',
            style: TextStyle(color: Color(0xFF716B66)),
          ),
        ],
      ),
    );
  }
}

class _ErrorModelState extends StatelessWidget {
  const _ErrorModelState({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: onRetry,
            child: const Text('重新加载'),
          ),
        ],
      ),
    );
  }
}
