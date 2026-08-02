import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:file_saver/file_saver.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';
import 'package:share_plus/share_plus.dart';

import '../models/share_outfit.dart';

class ShareOutfitService {
  const ShareOutfitService();

  Future<Uint8List> renderCard(
    GlobalKey repaintBoundaryKey, {
    double pixelRatio = 3,
  }) async {
    await WidgetsBinding.instance.endOfFrame;
    final context = repaintBoundaryKey.currentContext;
    final boundary = context?.findRenderObject();
    if (boundary is! RenderRepaintBoundary) {
      throw StateError('穿搭分享卡片尚未完成渲染');
    }
    final image = await boundary.toImage(pixelRatio: pixelRatio);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    if (bytes == null) {
      throw StateError('穿搭分享图片生成失败');
    }
    return bytes.buffer.asUint8List();
  }

  Future<void> saveCard({
    required GlobalKey repaintBoundaryKey,
    required ShareOutfit outfit,
  }) async {
    final bytes = await renderCard(repaintBoundaryKey);
    await FileSaver.instance.saveFile(
      name: outfit.fileName,
      bytes: bytes,
      fileExtension: 'png',
      mimeType: MimeType.png,
    );
  }

  Future<ShareResult> shareCard({
    required GlobalKey repaintBoundaryKey,
    required ShareOutfit outfit,
  }) async {
    final bytes = await renderCard(repaintBoundaryKey);
    return SharePlus.instance.share(
      ShareParams(
        title: '树皮 AI穿搭',
        text: outfit.caption,
        files: [
          XFile.fromData(
            bytes,
            mimeType: 'image/png',
            name: '${outfit.fileName}.png',
          ),
        ],
        fileNameOverrides: ['${outfit.fileName}.png'],
        downloadFallbackEnabled: true,
      ),
    );
  }
}
