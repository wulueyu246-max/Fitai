import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;
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
    if (bytes.length <= 96 * 1024) {
      return 'data:$mimeType;base64,${base64Encode(bytes)}';
    }
    final prepared = await compute(
      _prepareBodyPhoto,
      <String, Object>{
        'bytes': bytes,
        'mimeType': mimeType,
        'maxBytes': _config.maxImageBytes,
      },
    );
    final preparedBytes = prepared['bytes']! as Uint8List;
    final preparedMimeType = prepared['mimeType']! as String;
    return 'data:$preparedMimeType;base64,${base64Encode(preparedBytes)}';
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

Map<String, Object> _prepareBodyPhoto(Map<String, Object> input) {
  final originalBytes = input['bytes']! as Uint8List;
  final originalMimeType = input['mimeType']! as String;
  final maxBytes = input['maxBytes']! as int;
  final decoded = img.decodeImage(originalBytes);

  if (decoded == null) {
    throw const ImageDataException('无法解析所选照片');
  }

  final oriented = img.bakeOrientation(decoded);
  const longestEdgeLimit = 1600;
  final longestEdge =
      oriented.width > oriented.height ? oriented.width : oriented.height;
  final needsResize = longestEdge > longestEdgeLimit;
  final needsCompression = originalBytes.length > 1200 * 1024;

  if (!needsResize && !needsCompression) {
    return {'bytes': originalBytes, 'mimeType': originalMimeType};
  }

  final resized = needsResize
      ? (oriented.width >= oriented.height
          ? img.copyResize(oriented, width: longestEdgeLimit)
          : img.copyResize(oriented, height: longestEdgeLimit))
      : oriented;
  var quality = 80;
  var outputMimeType = 'image/jpeg';
  var compressed = Uint8List.fromList(img.encodeJpg(resized, quality: quality));

  while (compressed.length > maxBytes && quality > 55) {
    quality -= 5;
    compressed = Uint8List.fromList(img.encodeJpg(resized, quality: quality));
  }

  if (originalMimeType == 'image/png' &&
      originalBytes.length < compressed.length) {
    final pngBytes = Uint8List.fromList(img.encodePng(resized));
    if (pngBytes.length < compressed.length) {
      compressed = pngBytes;
      outputMimeType = 'image/png';
    }
  }

  if (compressed.length > maxBytes) {
    throw const ImageDataException('照片压缩后仍然过大，请重新选择');
  }

  return {'bytes': compressed, 'mimeType': outputMimeType};
}
