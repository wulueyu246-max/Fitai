import 'package:flutter/material.dart';

class HomeCategoryChips extends StatelessWidget {
  const HomeCategoryChips({
    required this.categories,
    required this.selectedCategory,
    required this.onSelected,
    super.key,
  });

  final List<String> categories;
  final String selectedCategory;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.zero,
        itemCount: categories.length,
        separatorBuilder: (_, __) => const SizedBox(width: 9),
        itemBuilder: (context, index) {
          final category = categories[index];
          final isSelected = category == selectedCategory;

          return Semantics(
            selected: isSelected,
            button: true,
            child: InkWell(
              borderRadius: BorderRadius.circular(999),
              onTap: () => onSelected(category),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                padding: const EdgeInsets.symmetric(
                  horizontal: 17,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: isSelected ? const Color(0xFF1A1918) : Colors.white,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: isSelected
                        ? const Color(0xFF1A1918)
                        : const Color(0xFFE9E6E1),
                  ),
                ),
                child: Text(
                  category,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                    color: isSelected ? Colors.white : const Color(0xFF4C4946),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
