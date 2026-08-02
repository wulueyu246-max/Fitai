import 'package:flutter/material.dart';

@immutable
class OutfitInspiration {
  const OutfitInspiration({
    required this.id,
    required this.title,
    required this.imageAsset,
    required this.tags,
    required this.views,
    required this.categories,
    required this.imageAspectRatio,
    required this.aiReason,
    required this.audience,
  });

  final String id;
  final String title;
  final String imageAsset;
  final List<String> tags;
  final String views;
  final List<String> categories;
  final double imageAspectRatio;
  final String aiReason;
  final String audience;

  bool matchesCategory(String category) {
    return category == '今日推荐' || categories.contains(category);
  }

  bool matchesQuery(String query) {
    final normalizedQuery = query.trim().toLowerCase();

    if (normalizedQuery.isEmpty) {
      return true;
    }

    return title.toLowerCase().contains(normalizedQuery) ||
        aiReason.toLowerCase().contains(normalizedQuery) ||
        audience.toLowerCase().contains(normalizedQuery) ||
        tags.any((tag) => tag.toLowerCase().contains(normalizedQuery)) ||
        categories.any(
          (category) => category.toLowerCase().contains(normalizedQuery),
        );
  }
}

@immutable
class FeaturedBrand {
  const FeaturedBrand({
    required this.name,
    required this.shortName,
    required this.backgroundColor,
    required this.foregroundColor,
  });

  final String name;
  final String shortName;
  final Color backgroundColor;
  final Color foregroundColor;
}
