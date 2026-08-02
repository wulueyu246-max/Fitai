import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/first_launch_profile.dart';

class OnboardingState {
  const OnboardingState({
    required this.completed,
    this.firstScene,
    this.profile,
  });

  final bool completed;
  final String? firstScene;
  final FirstLaunchProfile? profile;
}

abstract interface class OnboardingService {
  Future<OnboardingState> load();

  Future<void> complete({
    required String firstScene,
    FirstLaunchProfile? profile,
  });
}

class LocalOnboardingService implements OnboardingService {
  LocalOnboardingService({SharedPreferencesAsync? storage})
      : _storage = storage;

  static const _completedKey = 'fitai.onboarding.completed.v1';
  static const _sceneKey = 'fitai.onboarding.first_scene.v1';
  static const _profileKey = 'fitai.onboarding.profile.v2';

  SharedPreferencesAsync? _storage;
  OnboardingState? _memory;

  @override
  Future<OnboardingState> load() async {
    if (_memory case final state?) {
      return state;
    }
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      return _memory = OnboardingState(
        completed: await storage.getBool(_completedKey) ?? false,
        firstScene: await storage.getString(_sceneKey),
        profile: switch (await storage.getString(_profileKey)) {
          final String value => FirstLaunchProfile.fromJson(
              jsonDecode(value) as Map<String, dynamic>,
            ),
          null => null,
        },
      );
    } catch (_) {
      return _memory = const OnboardingState(completed: false);
    }
  }

  @override
  Future<void> complete({
    required String firstScene,
    FirstLaunchProfile? profile,
  }) async {
    _memory = OnboardingState(
      completed: true,
      firstScene: firstScene,
      profile: profile,
    );
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await Future.wait([
        storage.setBool(_completedKey, true),
        storage.setString(_sceneKey, firstScene),
        if (profile != null)
          storage.setString(_profileKey, jsonEncode(profile.toJson())),
      ]);
    } catch (_) {
      // The current session can continue even if local persistence fails.
    }
  }
}

class MemoryOnboardingService implements OnboardingService {
  MemoryOnboardingService({
    bool completed = false,
    String? firstScene,
    FirstLaunchProfile? profile,
  }) : _state = OnboardingState(
          completed: completed,
          firstScene: firstScene,
          profile: profile,
        );

  OnboardingState _state;

  @override
  Future<OnboardingState> load() async => _state;

  @override
  Future<void> complete({
    required String firstScene,
    FirstLaunchProfile? profile,
  }) async {
    _state = OnboardingState(
      completed: true,
      firstScene: firstScene,
      profile: profile,
    );
  }
}
