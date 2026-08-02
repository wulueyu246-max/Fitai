import 'package:flutter/material.dart';

import '../models/virtual_body_parameters.dart';
import '../models/virtual_model.dart';
import '../models/virtual_model_3d_scene.dart';
import 'virtual_model_preview.dart';

class VirtualModel3DView extends StatelessWidget {
  const VirtualModel3DView({
    required this.model,
    required this.bodyParameters,
    required this.viewAngle,
    required this.isUpdating,
    required this.onViewAngleChanged,
    super.key,
  });

  final VirtualModel model;
  final VirtualBodyParameters bodyParameters;
  final VirtualModelViewAngle viewAngle;
  final bool isUpdating;
  final ValueChanged<VirtualModelViewAngle> onViewAngleChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            for (final angle in VirtualModelViewAngle.values)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  key: Key('model-view-${angle.name}'),
                  label:
                      Text(angle == VirtualModelViewAngle.front ? '正面' : '背面'),
                  selected: viewAngle == angle,
                  onSelected: (_) => onViewAngleChanged(angle),
                ),
              ),
            const Spacer(),
            const Text(
              '左右拖动查看前后',
              style: TextStyle(color: Color(0xFF756E69), fontSize: 11),
            ),
          ],
        ),
        const SizedBox(height: 8),
        GestureDetector(
          key: const Key('virtual-model-3d-viewport'),
          behavior: HitTestBehavior.opaque,
          onHorizontalDragEnd: (details) {
            final velocity = details.primaryVelocity ?? 0;
            onViewAngleChanged(
              velocity < 0
                  ? VirtualModelViewAngle.back
                  : VirtualModelViewAngle.front,
            );
          },
          child: VirtualModelPreview(
            model: model,
            isUpdating: isUpdating,
            isBackView: viewAngle == VirtualModelViewAngle.back,
            bodyParameters: bodyParameters,
          ),
        ),
      ],
    );
  }
}
