import 'package:flutter/material.dart';

import '../models/virtual_model.dart';
import '../models/virtual_body_parameters.dart';
import '../models/virtual_model_3d_scene.dart';
import 'virtual_model_3d_view.dart';

class VirtualModelView extends StatelessWidget {
  const VirtualModelView({
    required this.model,
    required this.isUpdating,
    required this.bodyParameters,
    required this.viewAngle,
    required this.onViewAngleChanged,
    super.key,
  });

  final VirtualModel model;
  final bool isUpdating;
  final VirtualBodyParameters bodyParameters;
  final VirtualModelViewAngle viewAngle;
  final ValueChanged<VirtualModelViewAngle> onViewAngleChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                '用户数字分身',
                style: TextStyle(
                  color: Color(0xFF22201E),
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
              decoration: BoxDecoration(
                color: const Color(0xFFE9F0EC),
                borderRadius: BorderRadius.circular(999),
              ),
              child: const Text(
                'Mock 模型',
                style: TextStyle(
                  color: Color(0xFF466556),
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        VirtualModel3DView(
          model: model,
          bodyParameters: bodyParameters,
          viewAngle: viewAngle,
          isUpdating: isUpdating,
          onViewAngleChanged: onViewAngleChanged,
        ),
      ],
    );
  }
}
