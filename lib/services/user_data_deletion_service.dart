import '../features/user/services/user_session_controller.dart';
import 'consent_service.dart';
import 'digital_wardrobe_service.dart';
import 'user_profile_service.dart';

class PhotoDeletionReport {
  const PhotoDeletionReport({
    required this.profilePhotosRemoved,
    required this.wardrobeItemsRemoved,
    required this.avatarRemoved,
    required this.photoConsentRevoked,
  });

  final int profilePhotosRemoved;
  final int wardrobeItemsRemoved;
  final bool avatarRemoved;
  final bool photoConsentRevoked;

  int get totalLocalRecordsRemoved =>
      profilePhotosRemoved + wardrobeItemsRemoved + (avatarRemoved ? 1 : 0);
}

class UserDataDeletionService {
  UserDataDeletionService({
    UserProfileService? profileService,
    DigitalWardrobeService? wardrobeService,
    UserSessionController? sessionController,
    ConsentService? consentService,
  })  : _profileService = profileService ?? UserProfileService(),
        _wardrobeService = wardrobeService ?? DigitalWardrobeService(),
        _sessionController =
            sessionController ?? UserSessionController.instance,
        _consentService = consentService ?? ConsentService.instance;

  final UserProfileService _profileService;
  final DigitalWardrobeService _wardrobeService;
  final UserSessionController _sessionController;
  final ConsentService _consentService;

  Future<PhotoDeletionReport> deleteAllLocalPhotos() async {
    final profile = await _profileService.load();
    final profilePhotosRemoved = profile.photos.length +
        (profile.avatarBase64?.isNotEmpty == true ? 1 : 0);
    final avatarRemoved =
        _sessionController.account?.avatarBase64?.isNotEmpty == true;

    await Future.wait([
      _profileService.deletePhotos(profile),
      _sessionController.deleteAvatar(),
      _consentService.revokePhotoProcessing(),
    ]);
    final wardrobeItemsRemoved = await _wardrobeService.clearAll();
    return PhotoDeletionReport(
      profilePhotosRemoved: profilePhotosRemoved,
      wardrobeItemsRemoved: wardrobeItemsRemoved,
      avatarRemoved: avatarRemoved,
      photoConsentRevoked: true,
    );
  }
}
