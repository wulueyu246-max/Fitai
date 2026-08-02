import 'package:flutter/material.dart';

class StyleChip extends StatelessWidget {
  const StyleChip({
    required this.label,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? const Color(0xFF19181B) : Colors.white,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color:
                  selected ? const Color(0xFF19181B) : const Color(0xFFE8E4DE),
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : const Color(0xFF4F4A46),
              fontSize: 13,
              fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}
