import 'package:flutter/material.dart';

import '../models/product.dart';

class ProductImage extends StatelessWidget {
  const ProductImage({
    required this.product,
    this.width,
    this.height,
    this.fit = BoxFit.contain,
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
    Widget fallback(BuildContext context, Object error, StackTrace? stack) {
      return Container(
        width: width,
        height: height,
        color: const Color(0xFFF1EDE8),
        alignment: Alignment.center,
        padding: const EdgeInsets.all(12),
        child: const Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.checkroom_outlined, color: Color(0xFF8B827B)),
            SizedBox(height: 5),
            Text(
              '图片暂时无法加载',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF776F69), fontSize: 10.5),
            ),
          ],
        ),
      );
    }

    final image = product.isNetworkImage
        ? Image.network(
            product.imageUrl,
            width: width,
            height: height,
            fit: fit,
            semanticLabel: product.name,
            errorBuilder: fallback,
            loadingBuilder: (context, child, progress) => progress == null
                ? child
                : Container(
                    width: width,
                    height: height,
                    color: const Color(0xFFF5F2EE),
                    alignment: Alignment.center,
                    child: const SizedBox.square(
                      dimension: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
          )
        : Image.asset(
            product.imageUrl,
            width: width,
            height: height,
            fit: fit,
            cacheWidth: cacheWidth,
            semanticLabel: product.name,
            errorBuilder: fallback,
          );

    return borderRadius == null
        ? image
        : ClipRRect(borderRadius: borderRadius!, child: image);
  }
}
