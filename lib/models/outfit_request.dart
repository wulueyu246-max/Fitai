String normalizeOutfitGender(String? value) {
  final normalized = value?.trim().toLowerCase() ?? '';
  if (const {'male', 'man', 'men'}.contains(normalized) ||
      normalized.contains('\u7537')) {
    return 'male';
  }
  if (const {'female', 'woman', 'women'}.contains(normalized) ||
      normalized.contains('\u5973')) {
    return 'female';
  }
  return 'unisex';
}

class OutfitGenderResolution {
  const OutfitGenderResolution({
    required this.gender,
    required this.sourceUsed,
    required this.hasConflict,
    required this.accountGender,
    required this.profileGender,
    required this.initialGender,
  });

  final String gender;
  final String sourceUsed;
  final bool hasConflict;
  final String accountGender;
  final String profileGender;
  final String initialGender;
}

OutfitGenderResolution resolveOutfitGender({
  String? accountGender,
  String? profileGender,
  String? initialGender,
  bool accountIsCurrentUser = false,
  bool profileIsCurrentUser = false,
  bool initialIsCurrentFlow = false,
}) {
  final normalizedAccount = normalizeOutfitGender(accountGender);
  final normalizedProfile = normalizeOutfitGender(profileGender);
  final normalizedInitial = normalizeOutfitGender(initialGender);
  final explicitValues = {
    normalizedAccount,
    normalizedProfile,
    normalizedInitial,
  }..remove('unisex');
  final hasConflict = explicitValues.length > 1;

  String resolved = 'unisex';
  String sourceUsed = 'none';
  if (accountIsCurrentUser && normalizedAccount != 'unisex') {
    resolved = normalizedAccount;
    sourceUsed = 'account';
  } else if (profileIsCurrentUser && normalizedProfile != 'unisex') {
    resolved = normalizedProfile;
    sourceUsed = 'profile';
  } else if (initialIsCurrentFlow && normalizedInitial != 'unisex') {
    resolved = normalizedInitial;
    sourceUsed = 'initial';
  }

  return OutfitGenderResolution(
    gender: resolved,
    sourceUsed: sourceUsed,
    hasConflict: hasConflict,
    accountGender: normalizedAccount,
    profileGender: normalizedProfile,
    initialGender: normalizedInitial,
  );
}

class OutfitRequest {
  const OutfitRequest({
    required this.height,
    required this.weight,
    required this.scene,
    required this.request,
    required this.images,
    this.gender = 'unisex',
    this.itemBudget = '200-500',
    this.outfitBudget = '800-1500',
    this.location = const {},
    this.weather = const {},
    this.weatherConstraints = const [],
    this.bodyProfile = const {},
  });

  final double height;
  final double weight;
  final String scene;
  final String request;
  final Map<String, String> images;
  final String gender;
  final String itemBudget;
  final String outfitBudget;
  final Map<String, dynamic> location;
  final Map<String, dynamic> weather;
  final List<String> weatherConstraints;
  final Map<String, dynamic> bodyProfile;

  Map<String, dynamic> toJson() {
    final normalizedImages = <String, String>{};

    for (final role in const ['front', 'side', 'back']) {
      final image = images[role]?.trim();
      if (image != null && image.isNotEmpty) {
        normalizedImages[role] = image;
      }
    }

    final normalizedGender = gender.trim().isEmpty ? 'unisex' : gender.trim();
    final normalizedScene = scene.trim();
    final immutableUserInput = request.trim();
    return {
      'height': height,
      'weight': weight,
      'scene': normalizedScene,
      'request': immutableUserInput,
      'user_input': immutableUserInput,
      'gender': normalizedGender,
      'item_budget': itemBudget,
      'outfit_budget': outfitBudget,
      'images': normalizedImages,
      'context': {
        'scene': normalizedScene,
        'location': Map<String, dynamic>.from(location),
        'body_profile': {
          ...bodyProfile,
          'height': height,
          'weight': weight,
          'gender': normalizedGender,
        },
        'gender': normalizedGender,
      },
    };
  }
}
