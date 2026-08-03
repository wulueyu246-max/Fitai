import 'package:image_picker/image_picker.dart';
import 'package:image_picker_android/image_picker_android.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';

abstract interface class BodyPhotoPicker {
  Future<List<XFile>> pickFromGallery({int limit = 3});

  Future<List<XFile>> retrieveLostGalleryImages();
}

class SystemGalleryBodyPhotoPicker implements BodyPhotoPicker {
  SystemGalleryBodyPhotoPicker({ImagePicker? imagePicker})
      : _imagePicker = imagePicker ?? ImagePicker() {
    final platform = ImagePickerPlatform.instance;
    if (platform is ImagePickerAndroid) {
      platform.useAndroidPhotoPicker = true;
    }
  }

  final ImagePicker _imagePicker;

  @override
  Future<List<XFile>> pickFromGallery({int limit = 3}) {
    return _imagePicker.pickMultiImage(
      limit: limit,
      imageQuality: 72,
      maxWidth: 1440,
      maxHeight: 2160,
      requestFullMetadata: false,
    );
  }

  @override
  Future<List<XFile>> retrieveLostGalleryImages() async {
    final response = await _imagePicker.retrieveLostData();
    if (response.isEmpty) {
      return const [];
    }
    return response.files ?? const [];
  }
}
