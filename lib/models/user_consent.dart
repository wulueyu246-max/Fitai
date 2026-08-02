class UserConsent {
  const UserConsent({
    required this.termsVersion,
    required this.privacyVersion,
    required this.acceptedTerms,
    required this.acceptedPrivacy,
    required this.photoProcessingAllowed,
    this.updatedAt,
  });

  factory UserConsent.fromJson(Map<String, dynamic> json) {
    return UserConsent(
      termsVersion: json['termsVersion'] as String? ?? currentTermsVersion,
      privacyVersion:
          json['privacyVersion'] as String? ?? currentPrivacyVersion,
      acceptedTerms: json['acceptedTerms'] as bool? ?? false,
      acceptedPrivacy: json['acceptedPrivacy'] as bool? ?? false,
      photoProcessingAllowed: json['photoProcessingAllowed'] as bool? ?? false,
      updatedAt: json['updatedAt'] is String
          ? DateTime.tryParse(json['updatedAt'] as String)
          : null,
    );
  }

  static const currentTermsVersion = '2026-07-30';
  static const currentPrivacyVersion = '2026-07-30';

  final String termsVersion;
  final String privacyVersion;
  final bool acceptedTerms;
  final bool acceptedPrivacy;
  final bool photoProcessingAllowed;
  final DateTime? updatedAt;

  bool get hasRequiredConsent =>
      acceptedTerms &&
      acceptedPrivacy &&
      photoProcessingAllowed &&
      termsVersion == currentTermsVersion &&
      privacyVersion == currentPrivacyVersion;

  UserConsent copyWith({
    bool? acceptedTerms,
    bool? acceptedPrivacy,
    bool? photoProcessingAllowed,
    DateTime? updatedAt,
  }) {
    return UserConsent(
      termsVersion: currentTermsVersion,
      privacyVersion: currentPrivacyVersion,
      acceptedTerms: acceptedTerms ?? this.acceptedTerms,
      acceptedPrivacy: acceptedPrivacy ?? this.acceptedPrivacy,
      photoProcessingAllowed:
          photoProcessingAllowed ?? this.photoProcessingAllowed,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'termsVersion': termsVersion,
        'privacyVersion': privacyVersion,
        'acceptedTerms': acceptedTerms,
        'acceptedPrivacy': acceptedPrivacy,
        'photoProcessingAllowed': photoProcessingAllowed,
        'updatedAt': updatedAt?.toIso8601String(),
      };

  static const empty = UserConsent(
    termsVersion: currentTermsVersion,
    privacyVersion: currentPrivacyVersion,
    acceptedTerms: false,
    acceptedPrivacy: false,
    photoProcessingAllowed: false,
  );
}
