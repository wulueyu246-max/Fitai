import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../components/horizontal_product_carousel.dart';
import '../components/outfit_post_card.dart';
import '../components/product_image.dart';
import '../features/home/models/daily_fashion_context.dart';
import '../features/home/models/fashion_feed.dart';
import '../features/home/services/daily_context_service.dart';
import '../features/home/services/feed_recommendation_service.dart';
import '../features/home/services/outfit_challenge_service.dart';
import '../features/home/widgets/brand_list.dart';
import '../features/home/widgets/community_look_carousel.dart';
import '../features/home/widgets/feed_reveal.dart';
import '../features/home/widgets/home_header.dart';
import '../features/home/widgets/outfit_challenge_card.dart';
import '../features/home/widgets/scene_entry_carousel.dart';
import '../features/home/widgets/section_header.dart';
import '../features/home/widgets/today_ai_recommendation_card.dart';
import '../features/user/services/user_session_controller.dart';
import '../models/brand.dart';
import '../models/community_engagement.dart';
import '../models/fashion_profile.dart';
import '../models/outfit_post.dart';
import '../models/product.dart';
import '../models/product_analytics.dart';
import '../models/recommendation_feedback.dart';
import '../models/user_preference.dart';
import '../models/user_fashion_profile.dart';
import '../models/user_profile.dart';
import '../services/affiliate_service.dart';
import '../services/brand_product_service.dart';
import '../services/brand_service.dart';
import '../services/analytics_service.dart';
import '../services/community_engagement_service.dart';
import '../services/favorite_service.dart';
import '../services/fashion_profile_service.dart';
import '../services/product_analytics_service.dart';
import '../services/recommendation_feedback_service.dart';
import '../services/user_preference_service.dart';
import '../services/user_fashion_profile_service.dart';
import '../services/user_profile_service.dart';
import 'brand_page.dart';
import 'product_detail_page.dart';

class HomePage extends StatefulWidget {
  const HomePage({
    required this.onExploreAi,
    required this.onOpenProfile,
    this.brandService = const MockBrandService(),
    this.dailyContextService = const MockDailyContextService(),
    this.feedRecommendationService = const FeedRecommendationService(),
    this.productSource = const MockBrandProductService(),
    this.challengeService,
    this.sessionController,
    super.key,
  });

  final VoidCallback onExploreAi;
  final VoidCallback onOpenProfile;
  final BrandService brandService;
  final DailyContextService dailyContextService;
  final FeedRecommendationService feedRecommendationService;
  final BrandProductService productSource;
  final OutfitChallengeService? challengeService;
  final UserSessionController? sessionController;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final DateTime _openedAt = DateTime.now();
  final TextEditingController _searchController = TextEditingController();
  final FavoriteService _favoriteService = FavoriteService.instance;
  final UserPreferenceService _preferenceService = UserPreferenceService();
  final UserProfileService _profileService = UserProfileService();
  final FashionProfileService _fashionProfileService = FashionProfileService();
  final UserFashionProfileService _userFashionProfileService =
      UserFashionProfileService();
  final CommunityEngagementService _communityService =
      CommunityEngagementService();
  final ProductAnalyticsService _productAnalytics =
      ProductAnalyticsService.instance;
  final AffiliateService _affiliateService = LocalAffiliateService();
  final AnalyticsService _analytics = LocalAnalyticsService.instance;
  late final UserSessionController _session;
  final RecommendationFeedbackService _feedbackService =
      RecommendationFeedbackService.instance;
  final Set<String> _impressedProductIds = {};

  late final OutfitChallengeService _challengeService;
  UserPreference _preference = UserPreferenceService.defaultPreference;
  UserProfile _profile = UserProfileService.defaultProfile;
  late FashionProfile _fashionProfile;
  late UserFashionProfile _userFashionProfile;
  CommunityEngagement _community = const CommunityEngagement(
    likedPostIds: {},
    savedPostIds: {},
    followedAuthors: {},
    commentCounts: {},
  );
  List<RecommendationFeedback> _feedback = const [];
  // null 表示商品仓库尚未完成首次加载，此时推荐层使用内置数据库种子；
  // 空列表则表示仓库确实没有可售商品，不能再静默回退。
  List<Product>? _productCatalog;
  List<Brand> _brands = const [];
  late DailyFashionContext _dailyContext;
  late OutfitChallenge _challenge;
  late FashionFeed _feed;
  String _selectedScene = '通勤';
  String _searchQuery = '';
  String? _loadError;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _session = widget.sessionController ?? UserSessionController.instance;
    _challengeService = widget.challengeService ?? OutfitChallengeService();
    _fashionProfile = FashionProfile.fromUserData(
      profile: _profile,
      preference: _preference,
    );
    _userFashionProfile = UserFashionProfile.fromProfiles(
      user: _profile,
      fashion: _fashionProfile,
    );
    final now = DateTime.now();
    _dailyContext = DailyFashionContext(
      temperature: 25,
      condition: '多云',
      city: '本地',
      updatedAt: now,
    );
    _challenge = const OutfitChallenge(
      id: 'seven-day-look',
      title: '7天AI穿搭挑战',
      description: '每天生成一个新 Look，让 AI 更快理解你的真实偏好。',
      totalDays: 7,
      completedDays: 0,
      checkedInToday: false,
    );
    const explicitMockMode = bool.fromEnvironment(
      'MOCK_MODE',
      defaultValue: false,
    );
    if (!kReleaseMode || explicitMockMode) {
      _refreshFeed();
    }
    _favoriteService.addListener(_onFavoritesChanged);
    _session.addListener(_onSessionChanged);
    _loadFeedData();
  }

  @override
  void dispose() {
    unawaited(
      _analytics.trackPageDwell(
        'home',
        DateTime.now().difference(_openedAt),
      ),
    );
    _searchController.dispose();
    _favoriteService.removeListener(_onFavoritesChanged);
    _session.removeListener(_onSessionChanged);
    super.dispose();
  }

  List<Product> get _visibleProducts {
    final query = _searchQuery.trim().toLowerCase();
    if (query.isEmpty) {
      return _feed.products;
    }
    return _feed.products
        .where(
          (product) =>
              product.brand.toLowerCase().contains(query) ||
              product.name.toLowerCase().contains(query) ||
              product.style.toLowerCase().contains(query) ||
              product.category.toLowerCase().contains(query),
        )
        .toList(growable: false);
  }

  List<String> get _tryOnProductIds {
    return _favoriteService.tryOnHistory
        .expand((record) => record.outfitPlan.products)
        .map((product) => product.id)
        .toSet()
        .toList(growable: false);
  }

  Future<void> _loadFeedData() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _loadError = null;
      });
    }
    try {
      final results = await Future.wait<Object?>([
        _preferenceService.load(),
        _profileService.load(),
        widget.brandService.getBrands(),
        _feedbackService.load(),
        widget.dailyContextService.getTodayContext(),
        _challengeService.load(),
        _favoriteService.ensureLoaded(),
        _communityService.load(),
        _analytics.trackSession(),
        _session.ensureLoaded(),
        widget.productSource.fetchProducts(),
      ]);
      final preference = results[0]! as UserPreference;
      final storedProfile = results[1]! as UserProfile;
      final account = _session.account;
      final profile = account == null
          ? storedProfile
          : storedProfile.copyWith(
              height: account.height,
              weight: account.weight,
              age: account.age,
              gender: account.gender,
              bodyType: account.bodyType,
              stylePreference: account.likedStyles,
              favoriteBrands: account.favoriteBrands,
              avatarBase64: account.avatarBase64,
            );
      final baseFashionProfile = await _fashionProfileService.loadOrCreate(
        profile: profile,
        preference: preference,
      );
      final analyticsSnapshot = await _productAnalytics.getSnapshot();
      final fashionProfile = await _fashionProfileService.generateAIProfile(
        base: account == null
            ? baseFashionProfile
            : baseFashionProfile.copyWith(
                likedStyles: account.likedStyles,
                likedBrands: account.favoriteBrands,
                budgetMin: account.budgetMin,
                budgetMax: account.budgetMax,
              ),
        productEvents: analyticsSnapshot.events,
        favoriteProducts: _favoriteService.favoriteProducts,
        photoAnalysisCount: _favoriteService.aiRecommendationHistory.length,
      );
      final userFashionProfile = await _userFashionProfileService.loadOrCreate(
        user: profile,
        fashion: fashionProfile,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _preference = preference;
        _profile = profile;
        _fashionProfile = fashionProfile;
        _userFashionProfile = userFashionProfile;
        _brands = results[2]! as List<Brand>;
        _feedback = results[3]! as List<RecommendationFeedback>;
        _dailyContext = results[4]! as DailyFashionContext;
        _challenge = results[5]! as OutfitChallenge;
        _community = results[7]! as CommunityEngagement;
        _productCatalog = results[10]! as List<Product>;
        _refreshFeed();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        const explicitMockMode = bool.fromEnvironment(
          'MOCK_MODE',
          defaultValue: false,
        );
        if (kReleaseMode && !explicitMockMode) {
          _productCatalog = const [];
          _loadError = '商品暂时加载失败，请重试';
        } else {
          _loadError = '个性化信息流加载失败，已使用本地推荐';
          _refreshFeed();
        }
      });
    }
  }

  void _refreshFeed() {
    _feed = widget.feedRecommendationService.recommend(
      FeedRecommendationInput(
        userProfile: _profile,
        fashionProfile: _fashionProfile,
        userFashionProfile: _userFashionProfile,
        aiBodyAnalysis: _preference.bodyFeatures.join('、'),
        browsingRecords: _preference.browsingHistory,
        favoriteProductIds: _favoriteService.productIds,
        tryOnProductIds: _tryOnProductIds,
        feedback: _feedback,
        context: _dailyContext,
        challenge: _challenge,
        scene: _selectedScene,
        query: _searchQuery,
        productCatalog: _productCatalog,
      ),
    );
    _scheduleProductImpressions();
  }

  void _scheduleProductImpressions() {
    final products = {
      ..._feed.products,
      ..._feed.hotLooks.expand((post) => post.products),
    }.where((product) => _impressedProductIds.add(product.id)).toList();
    if (products.isEmpty) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(
        _productAnalytics.recordImpressions(
          products,
          source: 'home-fashion-feed',
          userId: _session.account?.id ?? 'local-demo-user',
        ),
      );
    });
  }

  void _onFavoritesChanged() {
    if (mounted) {
      setState(_refreshFeed);
    }
  }

  void _onSessionChanged() {
    if (mounted && !_session.loading && !_loading) {
      unawaited(_loadFeedData());
    }
  }

  Future<void> _selectScene(FashionScene scene) async {
    setState(() {
      _selectedScene = scene.title;
      _refreshFeed();
    });
    final preference = await _preferenceService.recordBrowse(
      _preference,
      'scene:${scene.id}',
    );
    if (mounted) {
      setState(() {
        _preference = preference;
        _refreshFeed();
      });
    }
  }

  Future<void> _toggleProductFavorite(Product product) async {
    final favorite = await _favoriteService.toggleProduct(product);
    _profile = await _profileService.syncFavorites(
      _profile,
      _favoriteService.productIds,
    );
    if (favorite) {
      await _recordProductFeedback(
        RecommendationFeedbackAction.favorite,
        product,
        source: 'home-feed-product',
      );
    }
    if (mounted) {
      setState(_refreshFeed);
      _showMessage(favorite ? '商品已收藏，推荐偏好已更新' : '已取消收藏商品');
    }
  }

  Future<void> _toggleDailyLook() async {
    final favorite = await _favoriteService.toggleOutfitPlan(_feed.dailyPlan);
    if (favorite) {
      await _feedbackService.record(
        action: RecommendationFeedbackAction.favorite,
        outfitPlanId: _feed.dailyPlan.id,
        source: 'home-daily-look',
      );
      _feedback = _feedbackService.records;
    }
    if (mounted) {
      setState(_refreshFeed);
      _showMessage(favorite ? '今日 Look 已保存到衣橱' : '已取消保存今日 Look');
    }
  }

  Future<void> _togglePostFavorite(OutfitPost post) async {
    final community = await _communityService.toggleSave(post.id);
    final favorite = community.savedPostIds.contains(post.id);
    if (mounted) {
      setState(() => _community = community);
    }
    _showMessage(favorite ? 'AI Look 已收藏' : '已取消收藏');
    if (favorite && post.products.isNotEmpty) {
      _recordProductFeedback(
        RecommendationFeedbackAction.favorite,
        post.products.first,
        source: 'home-hot-look',
      );
    }
  }

  Future<void> _togglePostLike(OutfitPost post) async {
    final community = await _communityService.toggleLike(post.id);
    if (mounted) {
      setState(() => _community = community);
    }
  }

  Future<void> _toggleFollow(OutfitPost post) async {
    final community = await _communityService.toggleFollow(post.user);
    if (mounted) {
      setState(() => _community = community);
      _showMessage(
        community.followedAuthors.contains(post.user)
            ? '已关注 ${post.user}'
            : '已取消关注',
      );
    }
  }

  Future<void> _commentPost(OutfitPost post) async {
    final controller = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('评论这个 AI Look'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 3,
          decoration: const InputDecoration(hintText: '分享你的搭配想法'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(
              context,
              controller.text.trim().isNotEmpty,
            ),
            child: const Text('发布'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (submitted != true) {
      return;
    }
    final community = await _communityService.addComment(post.id);
    if (mounted) {
      setState(() => _community = community);
      _showMessage('评论已发布');
    }
  }

  Future<void> _openPost(OutfitPost post) async {
    if (post.products.isNotEmpty) {
      await _recordProductFeedback(
        RecommendationFeedbackAction.click,
        post.products.first,
        source: 'home-hot-look',
      );
    }
    final preference = await _preferenceService.recordBrowse(
      _preference,
      post.id,
    );
    if (!mounted) {
      return;
    }
    setState(() {
      _preference = preference;
      _refreshFeed();
    });
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => _LookDetailSheet(
        post: post,
        onGenerate: () {
          Navigator.pop(context);
          widget.onExploreAi();
        },
        onProductTap: (product) {
          Navigator.pop(context);
          _openProductDetails(product);
        },
      ),
    );
  }

  Future<void> _openProductDetails(Product product) async {
    await Future.wait([
      _feedbackService.record(
        action: RecommendationFeedbackAction.click,
        productId: product.id,
        outfitPlanId: _feed.dailyPlan.id,
        source: 'home-feed-product',
      ),
      _affiliateService.recordProductClick(
        product: product,
        source: 'home-feed-product',
        userId: _session.account?.id ?? 'local-demo-user',
      ),
    ]);
    _feedback = _feedbackService.records;
    _userFashionProfile = await _userFashionProfileService.recordClick(
      _userFashionProfile,
      product.id,
    );
    if (!mounted) {
      return;
    }
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ProductDetailPage(
          product: product,
          userId: _session.account?.id ?? 'local-demo-user',
          trackOpen: false,
          onFavorite: _toggleProductFavorite,
          onAddToWardrobe: _addProductToWardrobe,
          onPurchase: _recordPurchaseIntent,
        ),
      ),
    );
  }

  Future<void> _addProductToWardrobe(Product product) async {
    if (!_favoriteService.isProductFavorite(product.id)) {
      await _toggleProductFavorite(product);
    }
  }

  Future<void> _recordPurchaseIntent(Product product) async {
    await _feedbackService.record(
      action: RecommendationFeedbackAction.purchase,
      productId: product.id,
      outfitPlanId: _feed.dailyPlan.id,
      source: 'home-product-detail',
    );
    _feedback = _feedbackService.records;
    final results = await Future.wait<Object?>([
      _profileService.recordPurchase(_profile, product.sku),
      _preferenceService.recordPurchase(_preference, product.sku),
      _fashionProfileService.recordPurchase(_fashionProfile, product.sku),
    ]);
    if (!mounted) {
      return;
    }
    setState(() {
      _profile = results[0] as UserProfile;
      _preference = results[1] as UserPreference;
      _fashionProfile = results[2] as FashionProfile;
      _refreshFeed();
    });
  }

  Future<void> _recordProductFeedback(
    RecommendationFeedbackAction action,
    Product product, {
    required String source,
  }) async {
    await Future.wait([
      _feedbackService.record(
        action: action,
        productId: product.id,
        outfitPlanId: _feed.dailyPlan.id,
        source: source,
      ),
      _productAnalytics.record(
        action: switch (action) {
          RecommendationFeedbackAction.click => ProductAnalyticsAction.click,
          RecommendationFeedbackAction.favorite =>
            ProductAnalyticsAction.favorite,
          RecommendationFeedbackAction.tryOn => ProductAnalyticsAction.tryOn,
          RecommendationFeedbackAction.purchase =>
            ProductAnalyticsAction.purchaseRedirect,
        },
        product: product,
        source: source,
        userId: _session.account?.id ?? 'local-demo-user',
      ),
    ]);
    _feedback = _feedbackService.records;
  }

  Future<void> _joinChallenge() async {
    // Keep the retention action responsive while local history is persisted.
    widget.onExploreAi();
    final updated = await _challengeService.checkInToday();
    await _feedbackService.record(
      action: RecommendationFeedbackAction.click,
      outfitPlanId: _feed.dailyPlan.id,
      source: 'home-seven-day-challenge',
    );
    _feedback = _feedbackService.records;
    if (!mounted) {
      return;
    }
    setState(() {
      _challenge = updated;
      _refreshFeed();
    });
    _showMessage(
      updated.checkedInToday ? '今日挑战已记录，正在打开 AI 穿搭' : '挑战已开始',
    );
  }

  Future<void> _selectBrand(Brand brand) async {
    final results = await Future.wait<Object?>([
      _preferenceService.recordBrowse(_preference, 'brand:${brand.id}'),
      _fashionProfileService.recordBrand(_fashionProfile, brand.name),
      _analytics.track(
        'brand_page_open',
        properties: {'brandId': brand.id, 'brand': brand.name},
      ),
    ]);
    if (!mounted) {
      return;
    }
    setState(() {
      _preference = results[0]! as UserPreference;
      _fashionProfile = results[1]! as FashionProfile;
      _refreshFeed();
    });
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => BrandPage(
          brand: brand,
          brandService: widget.brandService,
        ),
      ),
    );
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

  void _showMessages() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        return SafeArea(
          child: ListTile(
            contentPadding: const EdgeInsets.fromLTRB(22, 8, 22, 28),
            leading: const CircleAvatar(
              child: Icon(Icons.auto_awesome_rounded),
            ),
            title: const Text('今日 AI Fashion Feed 已更新'),
            subtitle: Text(
              '${_feed.context.temperatureLabel} ${_feed.context.detailLabel} · '
              '${_feed.personalizationSummary}',
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    const explicitMockMode = bool.fromEnvironment(
      'MOCK_MODE',
      defaultValue: false,
    );
    if (kReleaseMode && !explicitMockMode && (_loading || _loadError != null)) {
      return ColoredBox(
        color: const Color(0xFFF7F3EA),
        child: Center(
          child: _loading
              ? const CircularProgressIndicator()
              : _HomeNotice(message: _loadError!, onRetry: _loadFeedData),
        ),
      );
    }
    final posts = _feed.hotLooks;
    final products = _visibleProducts;

    return ColoredBox(
      color: const Color(0xFFF7F3EA),
      child: RefreshIndicator(
        onRefresh: _loadFeedData,
        child: ListView(
          key: const Key('ai-fashion-feed'),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: EdgeInsets.fromLTRB(
            MediaQuery.sizeOf(context).width < 430 ? 14 : 18,
            16,
            MediaQuery.sizeOf(context).width < 430 ? 14 : 18,
            56,
          ),
          children: [
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1120),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    HomeHeader(
                      searchController: _searchController,
                      onSearchChanged: (query) {
                        setState(() {
                          _searchQuery = query;
                          _refreshFeed();
                        });
                      },
                      onMessageTap: _showMessages,
                      onProfileTap: widget.onOpenProfile,
                    ),
                    if (_loading) ...[
                      const SizedBox(height: 10),
                      const LinearProgressIndicator(
                        minHeight: 2,
                        color: Color(0xFF244C3A),
                      ),
                    ],
                    if (_loadError case final error?) ...[
                      const SizedBox(height: 10),
                      _HomeNotice(message: error, onRetry: _loadFeedData),
                    ],
                    const SizedBox(height: 18),
                    if (!kReleaseMode || explicitMockMode) ...[
                      FeedReveal(
                        child: TodayAiRecommendationCard(
                          feed: _feed,
                          saved: _favoriteService.isOutfitPlanFavorite(
                            _feed.dailyPlan.id,
                          ),
                          onGenerate: widget.onExploreAi,
                          onSave: _toggleDailyLook,
                        ),
                      ),
                      const SizedBox(height: 32),
                      const HomeSectionHeader(
                        title: '穿搭场景',
                        subtitle: '选择今天要进入的生活状态',
                      ),
                      const SizedBox(height: 14),
                      FeedReveal(
                        child: SceneEntryCarousel(
                          scenes: _feed.scenes,
                          selectedScene: _selectedScene,
                          onSelected: _selectScene,
                        ),
                      ),
                      const SizedBox(height: 36),
                      HomeSectionHeader(
                        title: '热门AI Look',
                        subtitle: '$_selectedScene · AI分析与关联商品',
                      ),
                      const SizedBox(height: 15),
                      if (posts.isEmpty)
                        const _EmptySearchResult(label: '没有匹配的AI Look')
                      else
                        AnimatedSwitcher(
                          duration: const Duration(milliseconds: 300),
                          child: FeedReveal(
                            key: ValueKey(
                              'looks-$_selectedScene-$_searchQuery',
                            ),
                            child: _CommunityPostGrid(
                              posts: posts,
                              engagement: _community,
                              onFavorite: _togglePostFavorite,
                              onLike: _togglePostLike,
                              onComment: _commentPost,
                              onFollow: _toggleFollow,
                              onOpen: _openPost,
                              onTryOn: null,
                            ),
                          ),
                        ),
                      const SizedBox(height: 38),
                    ],
                    HomeSectionHeader(
                      title: '适合我的',
                      subtitle: _feed.personalizationSummary,
                    ),
                    const SizedBox(height: 16),
                    if (products.isEmpty)
                      const _EmptySearchResult(label: '没有匹配的商品')
                    else
                      FeedReveal(
                        child: HorizontalProductCarousel(
                          products: products,
                          favoriteProductIds: _favoriteService.productIds,
                          onFavorite: _toggleProductFavorite,
                          onViewDetails: _openProductDetails,
                        ),
                      ),
                    const SizedBox(height: 40),
                    const HomeSectionHeader(
                      title: '品牌专区',
                      subtitle: '品牌目录、库存与购买链路接入位',
                    ),
                    const SizedBox(height: 16),
                    if (_brands.isEmpty)
                      const _EmptySearchResult(label: '品牌数据加载中')
                    else
                      FeedReveal(
                        child: FeaturedBrandList(
                          brands: _brands,
                          onBrandTap: _selectBrand,
                        ),
                      ),
                    if (!kReleaseMode || explicitMockMode) ...[
                      const SizedBox(height: 40),
                      const HomeSectionHeader(
                        title: '用户分享',
                        subtitle: '真实用户的 AI Look 与关联商品',
                      ),
                      const SizedBox(height: 16),
                      FeedReveal(
                        child: CommunityLookCarousel(
                          posts: _feed.communityLooks,
                          engagement: _community,
                          onFavorite: _togglePostFavorite,
                          onLike: _togglePostLike,
                          onComment: _commentPost,
                          onFollow: _toggleFollow,
                          onOpen: _openPost,
                        ),
                      ),
                    ],
                    if (const bool.fromEnvironment(
                      'ENABLE_EXPERIMENTS',
                      defaultValue: false,
                    )) ...[
                      const SizedBox(height: 40),
                      const HomeSectionHeader(
                        title: 'AI穿搭挑战',
                        subtitle: '把一次分析变成每天都想回来的习惯',
                      ),
                      const SizedBox(height: 16),
                      FeedReveal(
                        child: OutfitChallengeCard(
                          challenge: _feed.challenge,
                          onJoin: _joinChallenge,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CommunityPostGrid extends StatelessWidget {
  const _CommunityPostGrid({
    required this.posts,
    required this.engagement,
    required this.onFavorite,
    required this.onLike,
    required this.onComment,
    required this.onFollow,
    required this.onOpen,
    this.onTryOn,
  });

  final List<OutfitPost> posts;
  final CommunityEngagement engagement;
  final ValueChanged<OutfitPost> onFavorite;
  final ValueChanged<OutfitPost> onLike;
  final ValueChanged<OutfitPost> onComment;
  final ValueChanged<OutfitPost> onFollow;
  final ValueChanged<OutfitPost> onOpen;
  final ValueChanged<OutfitPost>? onTryOn;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 760 ? 3 : 2;
        const gap = 12.0;
        final width = (constraints.maxWidth - gap * (columns - 1)) / columns;
        return Wrap(
          spacing: gap,
          runSpacing: 14,
          children: [
            for (final post in posts)
              SizedBox(
                width: width,
                child: OutfitPostCard(
                  post: post,
                  favorite: engagement.savedPostIds.contains(post.id),
                  liked: engagement.likedPostIds.contains(post.id),
                  following: engagement.followedAuthors.contains(post.user),
                  commentCount: engagement.commentCounts[post.id],
                  onFavorite: () => onFavorite(post),
                  onLike: () => onLike(post),
                  onComment: () => onComment(post),
                  onFollow: () => onFollow(post),
                  onOpen: () => onOpen(post),
                  onTryOn: onTryOn == null ? null : () => onTryOn!(post),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _LookDetailSheet extends StatelessWidget {
  const _LookDetailSheet({
    required this.post,
    required this.onGenerate,
    required this.onProductTap,
  });

  final OutfitPost post;
  final VoidCallback onGenerate;
  final ValueChanged<Product> onProductTap;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(22, 4, 22, 28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              post.title,
              style: const TextStyle(
                fontSize: 23,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '${post.user} · ${post.likes} 人喜欢',
              style: const TextStyle(color: Color(0xFF817A75)),
            ),
            const SizedBox(height: 14),
            Text(
              'AI分析：${post.description}',
              style: const TextStyle(fontSize: 14, height: 1.55),
            ),
            const SizedBox(height: 18),
            for (final product in post.products)
              ListTile(
                contentPadding: EdgeInsets.zero,
                onTap: () => onProductTap(product),
                leading: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: ProductImage(
                    product: product,
                    width: 48,
                    height: 58,
                    fit: BoxFit.cover,
                  ),
                ),
                title: Text('${product.brand} ${product.name}'),
                subtitle: Text(
                  product.aiReason,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: Text(product.displayPrice),
              ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: onGenerate,
                icon: const Icon(Icons.auto_awesome_rounded),
                label: const Text('生成我的同款方案'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HomeNotice extends StatelessWidget {
  const _HomeNotice({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFFFF1D8),
      borderRadius: BorderRadius.circular(14),
      child: ListTile(
        dense: true,
        leading: const Icon(Icons.info_outline_rounded),
        title: Text(message),
        trailing: TextButton(onPressed: onRetry, child: const Text('重试')),
      ),
    );
  }
}

class _EmptySearchResult extends StatelessWidget {
  const _EmptySearchResult({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 42),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        children: [
          const Icon(Icons.search_off_rounded, color: Color(0xFF99928C)),
          const SizedBox(height: 9),
          Text(label),
        ],
      ),
    );
  }
}
