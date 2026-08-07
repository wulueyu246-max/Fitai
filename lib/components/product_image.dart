import 'package:flutter/material.dart';

import '../core/logging/app_logger.dart';
import '../models/product.dart';

class ProductImage extends StatelessWidget {
  const ProductImage({
    required this.product,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.cacheWidth,
    this.borderRadius,
    super.key,
  });

  final Product product;
  final double? width;
  final double? height;
  final BoxFit fit;
  final int? cacheWidth;
  final BorderRadius? borderRadius;

  @override
  Widget build(BuildContext context) {
    final resolvedWidth = width ?? double.infinity;
    final resolvedHeight = height ?? double.infinity;

    Widget fallback({bool loading = false}) {
      return Container(
        key: Key(
          loading
              ? 'product-image-loading-${product.id}'
              : 'product-image-placeholder-${product.id}',
        ),
        width: resolvedWidth,
        height: resolvedHeight,
        color: const Color(0xFFF1EDE8),
        alignment: Alignment.center,
        padding: const EdgeInsets.all(12),
        child: loading
            ? const SizedBox.square(
                dimension: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : LayoutBuilder(
                builder: (context, constraints) {
                  if (constraints.maxHeight < 72 || constraints.maxWidth < 80) {
                    return const Icon(
                      Icons.checkroom_outlined,
                      color: Color(0xFF8B827B),
                    );
                  }
                  return const Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.checkroom_outlined,
                        color: Color(0xFF8B827B),
                      ),
                      SizedBox(height: 5),
                      Text(
                        '图片暂时无法加载',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Color(0xFF776F69),
                          fontSize: 10.5,
                        ),
                      ),
                    ],
                  );
                },
              ),
      );
    }

    if (!product.isNetworkImage) {
      return _clip(fallback());
    }

    final image = Image.network(
      product.imageUrl,
      width: resolvedWidth,
      height: resolvedHeight,
      fit: fit,
      cacheWidth: cacheWidth,
      semanticLabel: product.name,
      errorBuilder: (context, error, stackTrace) {
        AppLogger.instance.warning(
          'product_image_load_failed',
          metadata: {
            'productId': product.id,
            'urlOrigin': _redactedUrl(product.imageUrl),
            'errorType': error.runtimeType.toString(),
          },
        );
        return fallback();
      },
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : fallback(loading: true),
    );

    return _clip(image);
  }

  Widget _clip(Widget image) {
    return borderRadius == null
        ? image
        : ClipRRect(borderRadius: borderRadius!, child: image);
  }

  String _redactedUrl(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null || uri.host.isEmpty) return '[invalid]';
    return '${uri.scheme}://${uri.host}/…';
  }
}
