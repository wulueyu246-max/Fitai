import 'package:flutter/material.dart';

import '../models/first_launch_profile.dart';
import '../core/logging/app_logger.dart';
import '../services/analytics_service.dart';
import '../services/onboarding_service.dart';
import '../services/location_service.dart';
import '../services/user_profile_service.dart';
import 'main_placeholder.dart';
import 'onboarding_page.dart';
import 'location_setup_page.dart';

typedef MainExperienceBuilder = Widget Function(
  FirstLaunchProfile? firstLaunchProfile,
  int initialIndex,
);

class FirstRunGate extends StatefulWidget {
  const FirstRunGate({
    required this.builder,
    this.service,
    this.analyticsService,
    this.locationService,
    this.loadTimeout = const Duration(seconds: 10),
    super.key,
  });

  final MainExperienceBuilder builder;
  final OnboardingService? service;
  final AnalyticsService? analyticsService;
  final LocationService? locationService;
  final Duration loadTimeout;

  @override
  State<FirstRunGate> createState() => _FirstRunGateState();
}

class _FirstRunGateState extends State<FirstRunGate> {
  late final OnboardingService _service;
  late final AnalyticsService _analytics;
  late final LocationService _locationService;
  final UserProfileService _profileService = UserProfileService();
  OnboardingState? _state;
  bool _startFirstTask = false;
  bool _locationChecked = false;
  bool _needsLocation = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? LocalOnboardingService();
    _analytics = widget.analyticsService ?? LocalAnalyticsService.instance;
    _locationService = widget.locationService ?? DeviceLocationService();
    _load();
  }

  Future<void> _load() async {
    OnboardingState state;
    Object? location;
    try {
      final results = await Future.wait([
        _service.load(),
        _locationService.load(),
      ]).timeout(widget.loadTimeout);
      state = results[0] as OnboardingState;
      location = results[1];
    } catch (error, stackTrace) {
      AppLogger.instance.error(
        'first_run_state_load_failed',
        error: error,
        stackTrace: stackTrace,
      );
      state = const OnboardingState(completed: false);
    }
    if (mounted) {
      setState(() {
        _state = state;
        _needsLocation = location == null;
        _locationChecked = true;
      });
    }
  }

  void _completeLocation(Object _) {
    setState(() => _needsLocation = false);
  }

  Future<void> _complete(FirstLaunchProfile firstLaunchProfile) async {
    final currentProfile = await _profileService.load();
    final sceneNeeds = <String>{
      firstLaunchProfile.scene,
      ...currentProfile.sceneNeeds,
    }.toList(growable: false);
    await _profileService.save(
      currentProfile.copyWith(
        gender: firstLaunchProfile.gender,
        height: firstLaunchProfile.height,
        weight: firstLaunchProfile.weight,
        age: firstLaunchProfile.representativeAge,
        occupation: firstLaunchProfile.occupation,
        budgetMin: firstLaunchProfile.budgetMin,
        budgetMax: firstLaunchProfile.budgetMax,
        sceneNeeds: sceneNeeds,
      ),
    );
    await Future.wait([
      _service.complete(
        firstScene: firstLaunchProfile.scene,
        profile: firstLaunchProfile,
      ),
      _analytics.track(
        'new_user_onboarding_completed',
        properties: {
          'gender': firstLaunchProfile.gender,
          'ageRange': firstLaunchProfile.ageRange,
          'occupation': firstLaunchProfile.occupation,
          'scene': firstLaunchProfile.scene,
          'budgetRange':
              '${firstLaunchProfile.budgetMin.round()}-${firstLaunchProfile.budgetMax.round()}',
        },
      ),
    ]);
    if (mounted) {
      setState(() {
        _state = OnboardingState(
          completed: true,
          firstScene: firstLaunchProfile.scene,
          profile: firstLaunchProfile,
        );
        _startFirstTask = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = _state;
    if (state == null || !_locationChecked) {
      return const FitAILaunchPlaceholder();
    }
    if (_needsLocation) {
      return LocationSetupPage(
        service: _locationService,
        onComplete: _completeLocation,
      );
    }
    if (!state.completed) {
      return OnboardingPage(onComplete: _complete);
    }
    return widget.builder(
      _startFirstTask ? state.profile : null,
      _startFirstTask ? 1 : 0,
    );
  }
}
