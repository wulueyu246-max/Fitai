import 'package:flutter/material.dart';

import '../models/virtual_body_parameters.dart';

class BodyParameterPanel extends StatelessWidget {
  const BodyParameterPanel({
    required this.parameters,
    required this.onChanged,
    super.key,
  });

  final VirtualBodyParameters parameters;
  final ValueChanged<VirtualBodyParameters> onChanged;

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      key: const Key('body-parameter-panel'),
      tilePadding: const EdgeInsets.symmetric(horizontal: 16),
      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      collapsedShape:
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      backgroundColor: Colors.white,
      collapsedBackgroundColor: Colors.white,
      leading: const Icon(Icons.tune_rounded),
      title: const Text(
        '调整数字人身材参数',
        style: TextStyle(fontWeight: FontWeight.w900),
      ),
      subtitle: Text(
        '${parameters.height.toStringAsFixed(0)}cm · '
        '${parameters.weight.toStringAsFixed(0)}kg · '
        '腿长比 ${(parameters.legRatio * 100).toStringAsFixed(0)}%',
      ),
      children: [
        _SliderRow(
          label: '身高',
          valueLabel: '${parameters.height.toStringAsFixed(0)} cm',
          value: parameters.height,
          min: 140,
          max: 210,
          onChanged: (value) => onChanged(parameters.copyWith(height: value)),
        ),
        _SliderRow(
          label: '体重',
          valueLabel: '${parameters.weight.toStringAsFixed(0)} kg',
          value: parameters.weight,
          min: 35,
          max: 150,
          onChanged: (value) => onChanged(parameters.copyWith(weight: value)),
        ),
        _SliderRow(
          label: '肩宽',
          valueLabel: '${(parameters.shoulderScale * 100).toStringAsFixed(0)}%',
          value: parameters.shoulderScale,
          min: 0.8,
          max: 1.2,
          onChanged: (value) =>
              onChanged(parameters.copyWith(shoulderScale: value)),
        ),
        _SliderRow(
          label: '腰围',
          valueLabel: '${(parameters.waistScale * 100).toStringAsFixed(0)}%',
          value: parameters.waistScale,
          min: 0.8,
          max: 1.2,
          onChanged: (value) =>
              onChanged(parameters.copyWith(waistScale: value)),
        ),
        _SliderRow(
          label: '腿长比例',
          valueLabel: '${(parameters.legRatio * 100).toStringAsFixed(0)}%',
          value: parameters.legRatio,
          min: 0.42,
          max: 0.6,
          onChanged: (value) => onChanged(parameters.copyWith(legRatio: value)),
        ),
      ],
    );
  }
}

class _SliderRow extends StatelessWidget {
  const _SliderRow({
    required this.label,
    required this.valueLabel,
    required this.value,
    required this.min,
    required this.max,
    required this.onChanged,
  });

  final String label;
  final String valueLabel;
  final double value;
  final double min;
  final double max;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(child: Text(label)),
            Text(valueLabel,
                style: const TextStyle(fontWeight: FontWeight.w800)),
          ],
        ),
        Slider(
            value: value.clamp(min, max),
            min: min,
            max: max,
            onChanged: onChanged),
      ],
    );
  }
}
