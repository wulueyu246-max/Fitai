import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'config/shupi_theme.dart';
import 'config/production_environment.dart';
import 'core/logging/app_logger.dart';
import 'features/user/repositories/local_auth_repository.dart';
import 'features/user/repositories/auth_repository.dart';
import 'features/user/repositories/remote_auth_repository.dart';
import 'features/user/services/user_session_controller.dart';
import 'models/first_launch_profile.dart';
import 'repositories/synced_wardrobe_repository.dart';
import 'repositories/wardrobe_repository.dart';
import 'pages/account_page.dart';
import 'pages/ai_outfit_page.dart';
import 'pages/home_page.dart';
import 'pages/first_run_gate.dart';
import 'pages/wardrobe_page.dart';
import 'features/home/services/daily_context_service.dart';
import 'services/brand_product_service.dart';
import 'services/onboarding_service.dart';
import 'services/product_service.dart';
import 'services/remote_brand_product_service.dart';
import 'services/wardrobe_sync_service.dart';
import 'services/location_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  ProductionEnvironment.fromDartDefines().validate();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: ShupiColors.surface,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );
  FlutterError.onError = (details) {
    AppLogger.instance.error(
      'flutter_framework_error',
      error: details.exception,
      stackTrace: details.stack,
      metadata: {'library': details.library ?? 'unknown'},
    );
    FlutterError.presentError(details);
  };
  PlatformDispatcher.instance.onError = (error, stackTrace) {
    AppLogger.instance.error(
      'unhandled_platform_error',
      error: error,
      stackTrace: stackTrace,
    );
    return true;
  };
  runApp(const FitAIApp());
}

class FitAIApp extends StatelessWidget {
  const FitAIApp({
    this.onboardingService,
    this.locationService,
    super.key,
  });

  final OnboardingService? onboardingService;
  final LocationService? locationService;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '树皮 Shupi',
      debugShowCheckedModeBanner: false,
      scrollBehavior: const FitAIScrollBehavior(),
      theme: ShupiTheme.light(),
      builder: (context, child) {
        final media = MediaQuery.of(context);
        return MediaQuery(
          data: media.copyWith(
            textScaler: media.textScaler.clamp(
              minScaleFactor: 0.9,
              maxScaleFactor: 1.35,
            ),
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
      home: FirstRunGate(
        service: onboardingService,
        locationService: locationService,
        builder: (firstLaunchProfile, initialIndex) => MainPage(
          firstLaunchProfile: firstLaunchProfile,
          initialIndex: initialIndex,
        ),
      ),
    );
  }
}

class FitAIScrollBehavior extends MaterialScrollBehavior {
  const FitAIScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices {
    return {
      ...super.dragDevices,
      PointerDeviceKind.mouse,
      PointerDeviceKind.trackpad,
    };
  }
}

class MainPage extends StatefulWidget {
  const MainPage({
    this.firstLaunchProfile,
    this.initialIndex = 0,
    super.key,
  });

  final FirstLaunchProfile? firstLaunchProfile;
  final int initialIndex;

  @override
  State<MainPage> createState() => _MainPageState();
}

class _MainPageState extends State<MainPage> {
  late int _currentIndex;

  late final List<Widget> _pages;
  late final BrandProductService _productSource;
  late final ProductService _productService;
  late final UserSessionController _sessionController;
  late final WardrobeRepository _wardrobeRepository;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex.clamp(0, 3);
    const catalogUrl = String.fromEnvironment('PRODUCT_CATALOG_URL');
    final catalogUri = Uri.tryParse(catalogUrl);
    _productSource =
        catalogUri != null && catalogUri.hasScheme && catalogUri.host.isNotEmpty
            ? RemoteBrandProductService(catalogEndpoint: catalogUri)
            : const MockBrandProductService();
    _productService = CatalogProductService(source: _productSource);
    const authApiBaseUrl = String.fromEnvironment('AUTH_API_BASE_URL');
    final authUri = Uri.tryParse(authApiBaseUrl);
    final authRepository =
        authUri != null && authUri.hasScheme && authUri.host.isNotEmpty
            ? RemoteAuthRepository(baseUrl: authUri) as AuthRepository
            : LocalAuthRepository() as AuthRepository;
    _sessionController = UserSessionController(repository: authRepository);
    final wardrobeSyncService =
        authUri != null && authUri.hasScheme && authUri.host.isNotEmpty
            ? RemoteWardrobeSyncService(
                baseUrl: authUri,
                sessionController: _sessionController,
              )
            : const NoopWardrobeSyncService();
    _wardrobeRepository = SyncedWardrobeRepository(
      sessionController: _sessionController,
      syncService: wardrobeSyncService,
    );
    _pages = [
      HomePage(
        onExploreAi: () => _selectPage(1),
        onOpenProfile: () => _selectPage(3),
        productSource: _productSource,
        sessionController: _sessionController,
        dailyContextService: LiveDailyContextService(),
      ),
      AiOutfitPage(
        productService: _productService,
        sessionController: _sessionController,
        wardrobeRepository: _wardrobeRepository,
        initialScene: widget.firstLaunchProfile?.scene,
        initialHeight: widget.firstLaunchProfile?.height,
        initialWeight: widget.firstLaunchProfile?.weight,
        initialRequest: widget.firstLaunchProfile == null
            ? null
            : '职业：${widget.firstLaunchProfile!.occupation}；预算：¥${widget.firstLaunchProfile!.budgetMin.round()}-¥${widget.firstLaunchProfile!.budgetMax.round()}',
      ),
      WardrobePage(
        repository: _wardrobeRepository,
      ),
      AccountPage(
        sessionController: _sessionController,
        wardrobeRepository: _wardrobeRepository,
        onOpenWardrobe: () => _selectPage(2),
      ),
    ];
  }

  void _selectPage(int index) {
    setState(() {
      _currentIndex = index;
    });
  }

  @override
  void dispose() {
    _sessionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: IndexedStack(index: _currentIndex, children: _pages),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: NavigationBar(
          selectedIndex: _currentIndex,
          onDestinationSelected: _selectPage,
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.home_outlined),
              selectedIcon: Icon(Icons.home_rounded),
              label: '首页',
            ),
            NavigationDestination(
              icon: Icon(Icons.auto_awesome_outlined),
              selectedIcon: Icon(Icons.auto_awesome_rounded),
              label: 'AI穿搭',
            ),
            NavigationDestination(
              icon: Icon(Icons.checkroom_outlined),
              selectedIcon: Icon(Icons.checkroom_rounded),
              label: '我的衣柜',
            ),
            NavigationDestination(
              icon: Icon(Icons.account_circle_outlined),
              selectedIcon: Icon(Icons.account_circle_rounded),
              label: '账户中心',
            ),
          ],
        ),
      ),
    );
  }
}
