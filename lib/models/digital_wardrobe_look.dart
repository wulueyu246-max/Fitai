import 'digital_wardrobe_item.dart';

class DigitalWardrobeLook {
  const DigitalWardrobeLook({
    required this.id,
    required this.title,
    required this.items,
    required this.aiReason,
    required this.createdAt,
  });

  final String id;
  final String title;
  final List<DigitalWardrobeItem> items;
  final String aiReason;
  final DateTime createdAt;
}
