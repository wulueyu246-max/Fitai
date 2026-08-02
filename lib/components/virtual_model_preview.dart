import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../models/product.dart';
import '../models/virtual_body_parameters.dart';
import '../models/virtual_model.dart';

class VirtualModelPreview extends StatelessWidget {
  const VirtualModelPreview({
    required this.model,
    this.isUpdating = false,
    this.isBackView = false,
    this.bodyParameters,
    super.key,
  });

  final VirtualModel model;
  final bool isUpdating;
  final bool isBackView;
  final VirtualBodyParameters? bodyParameters;

  @override
  Widget build(BuildContext context) {
    final body = bodyParameters ??
        VirtualBodyParameters(
          height: model.outfit.height,
          weight: model.outfit.weight,
        );
    final outfitSignature = [
      ...model.outfit.products.map((product) => product.id),
      isBackView ? 'back' : 'front',
      body.shoulderScale.toStringAsFixed(2),
      body.waistScale.toStringAsFixed(2),
      body.legRatio.toStringAsFixed(2),
    ].join('-');

    return Container(
      height: 570,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFEAE6EF),
            Color(0xFFF7F5F2),
          ],
        ),
        borderRadius: BorderRadius.circular(28),
        boxShadow: const [
          BoxShadow(
            color: Color(0x10251E2B),
            blurRadius: 26,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Stack(
        children: [
          const Positioned(
            right: -54,
            top: 78,
            child: _DecorativeCircle(
              size: 178,
              color: Color(0x277C6A91),
            ),
          ),
          const Positioned(
            left: -64,
            bottom: 54,
            child: _DecorativeCircle(
              size: 150,
              color: Color(0x2470A69B),
            ),
          ),
          Column(
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.72),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.auto_awesome_rounded,
                          size: 13,
                          color: Color(0xFF675875),
                        ),
                        SizedBox(width: 5),
                        Text(
                          'MOCK 3D TRY-ON',
                          style: TextStyle(
                            color: Color(0xFF675875),
                            fontSize: 9.5,
                            letterSpacing: 0.8,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Spacer(),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 200),
                    child: isUpdating
                        ? const SizedBox(
                            key: ValueKey('updating'),
                            width: 34,
                            height: 34,
                            child: Padding(
                              padding: EdgeInsets.all(7),
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Color(0xFF675875),
                              ),
                            ),
                          )
                        : _Avatar(
                            key: const ValueKey('avatar'),
                            dataUrl: model.avatarImage,
                          ),
                  ),
                ],
              ),
              Expanded(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 380),
                  switchInCurve: Curves.easeOutCubic,
                  transitionBuilder: (child, animation) {
                    return FadeTransition(
                      opacity: animation,
                      child: ScaleTransition(
                        scale: Tween<double>(begin: 0.97, end: 1).animate(
                          CurvedAnimation(
                            parent: animation,
                            curve: Curves.easeOutCubic,
                          ),
                        ),
                        child: child,
                      ),
                    );
                  },
                  child: SizedBox(
                    key: ValueKey(outfitSignature),
                    width: 270,
                    child: CustomPaint(
                      painter: _VirtualModelPainter(
                        model,
                        bodyParameters: body,
                        isBackView: isBackView,
                      ),
                    ),
                  ),
                ),
              ),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 7,
                runSpacing: 7,
                children: [
                  _AttributeChip(
                    icon: Icons.face_retouching_natural_rounded,
                    label: model.faceShape,
                  ),
                  _AttributeChip(
                    icon: Icons.content_cut_rounded,
                    label: model.hairstyle,
                  ),
                  _AttributeChip(
                    icon: Icons.accessibility_new_rounded,
                    label: model.bodyProportion,
                  ),
                  _AttributeChip(
                    icon: Icons.palette_outlined,
                    label: model.skinTone,
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _VirtualModelPainter extends CustomPainter {
  const _VirtualModelPainter(
    this.model, {
    required this.bodyParameters,
    required this.isBackView,
  });

  final VirtualModel model;
  final VirtualBodyParameters bodyParameters;
  final bool isBackView;

  @override
  void paint(Canvas canvas, Size size) {
    final centerX = size.width / 2;
    final skin = const Color(0xFFD7A47F);
    final hair = const Color(0xFF24201F);
    final outline = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = const Color(0x24231E1A);
    final outerwear = model.outfit.productForCategory(
      ProductCategory.outerwear,
    );
    final top = model.outfit.productForCategory(ProductCategory.top);
    final bottom = model.outfit.productForCategory(ProductCategory.bottom);
    final shoes = model.outfit.productForCategory(ProductCategory.shoes);
    final topColor = _productColor(top, const Color(0xFFF0EFEB));
    final outerColor = _productColor(outerwear, topColor);
    final bottomColor = _productColor(bottom, const Color(0xFF4B4B4C));
    final shoeColor = _productColor(shoes, const Color(0xFF242221));
    final bodyTop = size.height * 0.29;
    final bodyBottom = size.height *
        (0.63 - (bodyParameters.legRatio.clamp(0.42, 0.6) - 0.42) * 0.5);
    final legBottom = size.height * 0.9;

    canvas.drawOval(
      Rect.fromCenter(
        center: Offset(centerX, size.height * 0.93),
        width: size.width * 0.54,
        height: 18,
      ),
      Paint()
        ..color = const Color(0x1F26201D)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8),
    );

    final legWidth = size.width * 0.13;
    final legGap = size.width * 0.04;
    final leftLeg = RRect.fromRectAndRadius(
      Rect.fromLTRB(
        centerX - legGap / 2 - legWidth,
        bodyBottom - 8,
        centerX - legGap / 2,
        legBottom,
      ),
      const Radius.circular(10),
    );
    final rightLeg = RRect.fromRectAndRadius(
      Rect.fromLTRB(
        centerX + legGap / 2,
        bodyBottom - 8,
        centerX + legGap / 2 + legWidth,
        legBottom,
      ),
      const Radius.circular(10),
    );
    canvas
      ..drawRRect(leftLeg, Paint()..color = bottomColor)
      ..drawRRect(rightLeg, Paint()..color = bottomColor);

    final leftShoe = RRect.fromRectAndRadius(
      Rect.fromLTRB(
        centerX - legGap / 2 - legWidth - 8,
        legBottom - 8,
        centerX - legGap / 2 + 3,
        legBottom + 12,
      ),
      const Radius.circular(8),
    );
    final rightShoe = RRect.fromRectAndRadius(
      Rect.fromLTRB(
        centerX + legGap / 2 - 3,
        legBottom - 8,
        centerX + legGap / 2 + legWidth + 12,
        legBottom + 12,
      ),
      const Radius.circular(8),
    );
    canvas
      ..drawRRect(leftShoe, Paint()..color = shoeColor)
      ..drawRRect(rightShoe, Paint()..color = shoeColor);

    final neck = RRect.fromRectAndRadius(
      Rect.fromCenter(
        center: Offset(centerX, size.height * 0.275),
        width: size.width * 0.11,
        height: size.height * 0.09,
      ),
      const Radius.circular(9),
    );
    canvas.drawRRect(neck, Paint()..color = skin);

    final armPaint = Paint()..color = outerColor;
    final leftArm = RRect.fromRectAndRadius(
      Rect.fromLTRB(
        centerX - size.width * 0.31 * bodyParameters.shoulderScale,
        bodyTop + 12,
        centerX - size.width * 0.19 * bodyParameters.shoulderScale,
        bodyBottom + 9,
      ),
      const Radius.circular(18),
    );
    final rightArm = RRect.fromRectAndRadius(
      Rect.fromLTRB(
        centerX + size.width * 0.19 * bodyParameters.shoulderScale,
        bodyTop + 12,
        centerX + size.width * 0.31 * bodyParameters.shoulderScale,
        bodyBottom + 9,
      ),
      const Radius.circular(18),
    );
    canvas
      ..drawRRect(leftArm, armPaint)
      ..drawRRect(rightArm, armPaint);

    final torso = Path()
      ..moveTo(
        centerX - size.width * 0.2 * bodyParameters.shoulderScale,
        bodyTop,
      )
      ..quadraticBezierTo(
        centerX - size.width * 0.27 * bodyParameters.shoulderScale,
        bodyTop + 10,
        centerX - size.width * 0.23 * bodyParameters.waistScale,
        bodyBottom,
      )
      ..lineTo(
        centerX + size.width * 0.23 * bodyParameters.waistScale,
        bodyBottom,
      )
      ..quadraticBezierTo(
        centerX + size.width * 0.27 * bodyParameters.shoulderScale,
        bodyTop + 10,
        centerX + size.width * 0.2 * bodyParameters.shoulderScale,
        bodyTop,
      )
      ..close();
    canvas.drawPath(torso, Paint()..color = outerColor);
    canvas.drawPath(torso, outline);

    if (isBackView) {
      canvas.drawLine(
        Offset(centerX, bodyTop + 12),
        Offset(centerX, bodyBottom - 12),
        Paint()
          ..color = const Color(0x33423B42)
          ..strokeWidth = 1.2,
      );
    }

    if (outerwear != null && !isBackView) {
      final inner = Path()
        ..moveTo(centerX - size.width * 0.075, bodyTop)
        ..lineTo(centerX, bodyTop + size.height * 0.12)
        ..lineTo(centerX + size.width * 0.075, bodyTop)
        ..close();
      canvas.drawPath(inner, Paint()..color = topColor);

      final leftLapel = Path()
        ..moveTo(centerX - size.width * 0.075, bodyTop)
        ..lineTo(centerX, bodyTop + size.height * 0.12)
        ..lineTo(centerX - size.width * 0.055, bodyTop + size.height * 0.19)
        ..lineTo(centerX - size.width * 0.13, bodyTop + 8)
        ..close();
      final rightLapel = Path()
        ..moveTo(centerX + size.width * 0.075, bodyTop)
        ..lineTo(centerX, bodyTop + size.height * 0.12)
        ..lineTo(centerX + size.width * 0.055, bodyTop + size.height * 0.19)
        ..lineTo(centerX + size.width * 0.13, bodyTop + 8)
        ..close();
      final lapelPaint = Paint()..color = _lighten(outerColor, 0.06);
      canvas
        ..drawPath(leftLapel, lapelPaint)
        ..drawPath(rightLapel, lapelPaint)
        ..drawCircle(
          Offset(centerX, bodyTop + size.height * 0.205),
          2.3,
          Paint()..color = const Color(0xFF1D1C1C),
        );
    } else if (top?.id == 'cos-structured-shirt' && !isBackView) {
      canvas.drawLine(
        Offset(centerX, bodyTop + 8),
        Offset(centerX, bodyBottom - 8),
        Paint()
          ..color = const Color(0x33706D68)
          ..strokeWidth = 1,
      );
      for (var index = 0; index < 4; index++) {
        canvas.drawCircle(
          Offset(centerX, bodyTop + 45 + index * 32),
          1.7,
          Paint()..color = const Color(0xFFB3B0AB),
        );
      }
    }

    final headCenter = Offset(centerX, size.height * 0.18);
    final headRect = Rect.fromCenter(
      center: headCenter,
      width: size.width * 0.22,
      height: size.height * 0.18,
    );
    canvas
      ..drawOval(headRect, Paint()..color = skin)
      ..drawOval(headRect, outline);

    final hairPath = Path()
      ..moveTo(headRect.left + 2, headCenter.dy)
      ..quadraticBezierTo(
        headRect.left,
        headRect.top - 2,
        centerX,
        headRect.top - 7,
      )
      ..quadraticBezierTo(
        headRect.right + 2,
        headRect.top + 4,
        headRect.right - 1,
        headCenter.dy + 2,
      )
      ..quadraticBezierTo(
        centerX + size.width * 0.055,
        headRect.top + size.height * 0.035,
        headRect.left + 2,
        headCenter.dy,
      )
      ..close();
    canvas.drawPath(hairPath, Paint()..color = hair);

    final facePaint = Paint()
      ..color = const Color(0xFF4A342B)
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round;
    if (!isBackView) {
      canvas
        ..drawLine(
          Offset(centerX - size.width * 0.045, headCenter.dy - 3),
          Offset(centerX - size.width * 0.018, headCenter.dy - 3),
          facePaint,
        )
        ..drawLine(
          Offset(centerX + size.width * 0.018, headCenter.dy - 3),
          Offset(centerX + size.width * 0.045, headCenter.dy - 3),
          facePaint,
        )
        ..drawLine(
          Offset(centerX, headCenter.dy),
          Offset(centerX - 1, headCenter.dy + 12),
          facePaint..color = const Color(0x664A342B),
        )
        ..drawArc(
          Rect.fromCenter(
            center: Offset(centerX, headCenter.dy + 18),
            width: 22,
            height: 8,
          ),
          0.2,
          2.7,
          false,
          facePaint..color = const Color(0xFF8F5D51),
        );
    }
  }

  Color _productColor(Product? product, Color fallback) {
    final color = product?.color ?? '';

    if (color.contains('白')) {
      return const Color(0xFFF0EFEB);
    }

    if (color.contains('海军蓝')) {
      return const Color(0xFF202B43);
    }

    if (color.contains('炭灰')) {
      return const Color(0xFF48494B);
    }

    if (color.contains('黑')) {
      return const Color(0xFF242326);
    }

    return fallback;
  }

  Color _lighten(Color color, double amount) {
    return Color.lerp(color, Colors.white, amount) ?? color;
  }

  @override
  bool shouldRepaint(covariant _VirtualModelPainter oldDelegate) {
    final currentIds =
        model.outfit.products.map((product) => product.id).join();
    final oldIds =
        oldDelegate.model.outfit.products.map((product) => product.id).join();
    return currentIds != oldIds ||
        isBackView != oldDelegate.isBackView ||
        bodyParameters.shoulderScale !=
            oldDelegate.bodyParameters.shoulderScale ||
        bodyParameters.waistScale != oldDelegate.bodyParameters.waistScale ||
        bodyParameters.legRatio != oldDelegate.bodyParameters.legRatio;
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.dataUrl, super.key});

  final String? dataUrl;

  @override
  Widget build(BuildContext context) {
    final imageBytes = _decodeDataUrl(dataUrl);

    return Container(
      width: 38,
      height: 38,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.75),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2),
      ),
      clipBehavior: Clip.antiAlias,
      child: imageBytes == null
          ? const Icon(
              Icons.person_rounded,
              size: 21,
              color: Color(0xFF695A78),
            )
          : Image.memory(
              imageBytes,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => const Icon(
                Icons.person_rounded,
                size: 21,
                color: Color(0xFF695A78),
              ),
            ),
    );
  }

  Uint8List? _decodeDataUrl(String? dataUrl) {
    if (dataUrl == null || !dataUrl.contains(',')) {
      return null;
    }

    try {
      return base64Decode(dataUrl.split(',').last);
    } on FormatException {
      return null;
    }
  }
}

class _AttributeChip extends StatelessWidget {
  const _AttributeChip({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: const Color(0xFF71647D)),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF544D58),
              fontSize: 10.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _DecorativeCircle extends StatelessWidget {
  const _DecorativeCircle({
    required this.size,
    required this.color,
  });

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
      ),
    );
  }
}
