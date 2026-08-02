import 'dart:convert';
import 'dart:typed_data';

import 'package:image_picker/image_picker.dart';

import '../config/app_config.dart';

class ImageDataException implements Exception {
  const ImageDataException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ImageDataService {
  ImageDataService({AppConfig? config})
      : _config = config ?? AppConfig.fromEnvironment();

  final AppConfig _config;

  Future<Map<String, String>> encodeImages(
    Map<String, XFile> images, {
    Map<String, Uint8List> cachedBytes = const {},
  }) async {
    final encodedEntries = await Future.wait(
      images.entries.map((entry) async {
        return MapEntry(
          entry.key,
          await _toDataUrl(entry.value, cachedBytes[entry.key]),
        );
      }),
    );

    return Map<String, String>.fromEntries(encodedEntries);
  }

  Future<Uint8List> readValidatedBytes(XFile image) async {
    _mimeTypeFor(image);
    final fileLength = await image.length();

    if (fileLength > _config.maxImageBytes) {
      final limitMb = _config.maxImageBytes ~/ 1024 ~/ 1024;
      throw ImageDataException('单张图片不能超过 $limitMb MB');
    }

    return image.readAsBytes();
  }

  Future<String> _toDataUrl(XFile image, Uint8List? cachedBytes) async {
    final mimeType = _mimeTypeFor(image);
    final bytes = cachedBytes ?? await readValidatedBytes(image);
    if (bytes.length > _config.maxImageBytes) {
      final limitMb = _config.maxImageBytes ~/ 1024 ~/ 1024;
      throw ImageDataException('单张图片不能超过 $limitMb MB');
    }
    return 'data:$mimeType;base64,${base64Encode(bytes)}';
  }

  String _mimeTypeFor(XFile image) {
    final fileName = image.name.toLowerCase();

    if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (fileName.endsWith('.png')) {
      return 'image/png';
    }
    if (fileName.endsWith('.webp')) {
      return 'image/webp';
    }
    throw const ImageDataException('仅支持 JPG、PNG 或 WebP 图片');
  }
}
