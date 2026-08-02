import 'package:flutter/material.dart';

class ModelActionBar extends StatelessWidget {
  const ModelActionBar({
    required this.onRegenerate,
    required this.onChangeProduct,
    required this.onChangeColor,
    required this.onSave,
    required this.onShare,
    required this.saved,
    required this.generating,
    super.key,
  });

  final VoidCallback onRegenerate;
  final VoidCallback onChangeProduct;
  final VoidCallback onChangeColor;
  final VoidCallback onSave;
  final VoidCallback onShare;
  final bool saved;
  final bool generating;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      key: const Key('model-action-bar'),
      builder: (context, constraints) {
        final columns = constraints.maxWidth < 520 ? 3 : 5;
        const gap = 8.0;
        final itemWidth =
            (constraints.maxWidth - gap * (columns - 1)) / columns;
        final actions = [
          _ModelAction(
            icon: generating
                ? Icons.hourglass_top_rounded
                : Icons.refresh_rounded,
            label: generating ? '生成中' : '重新生成',
            onTap: generating ? null : onRegenerate,
          ),
          _ModelAction(
            icon: Icons.swap_horiz_rounded,
            label: '换一件',
            onTap: generating ? null : onChangeProduct,
          ),
          _ModelAction(
            icon: Icons.palette_outlined,
            label: '换颜色',
            onTap: generating ? null : onChangeColor,
          ),
          _ModelAction(
            icon:
                saved ? Icons.bookmark_rounded : Icons.bookmark_border_rounded,
            label: saved ? '已保存' : '保存搭配',
            onTap: onSave,
            highlighted: saved,
          ),
          _ModelAction(
            icon: Icons.ios_share_rounded,
            label: '分享',
            onTap: onShare,
          ),
        ];
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final action in actions)
              SizedBox(width: itemWidth, child: action),
          ],
        );
      },
    );
  }
}

class _ModelAction extends StatelessWidget {
  const _ModelAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.highlighted = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: highlighted ? const Color(0xFF242126) : Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          height: 72,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: highlighted
                  ? const Color(0xFF242126)
                  : const Color(0xFFE7E3DD),
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 20,
                color: highlighted
                    ? Colors.white
                    : onTap == null
                        ? const Color(0xFFAAA49E)
                        : const Color(0xFF4D4743),
              ),
              const SizedBox(height: 5),
              Text(
                label,
                maxLines: 1,
                style: TextStyle(
                  color: highlighted
                      ? Colors.white
                      : onTap == null
                          ? const Color(0xFFAAA49E)
                          : const Color(0xFF4D4743),
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
