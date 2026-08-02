enum WardrobeRecognitionStatus {
  recognizing,
  recognized,
  failed,
}

class DigitalWardrobeItem {
  const DigitalWardrobeItem({
    required this.id,
    required this.name,
    required this.imageBase64,
    required this.category,
    required this.color,
    required this.style,
    required this.material,
    required this.status,
    required this.createdAt,
  });

  factory DigitalWardrobeItem.fromJson(Map<String, dynamic> json) {
    return DigitalWardrobeItem(
      id: json['id'] as String,
      name: json['name'] as String,
      imageBase64: json['imageBase64'] as String,
      category: json['category'] as String,
      color: json['color'] as String,
      style: json['style'] as String,
      material: json['material'] as String,
      status: WardrobeRecognitionStatus.values.firstWhere(
        (value) => value.name == json['status'],
        orElse: () => WardrobeRecognitionStatus.failed,
      ),
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String name;
  final String imageBase64;
  final String category;
  final String color;
  final String style;
  final String material;
  final WardrobeRecognitionStatus status;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'imageBase64': imageBase64,
        'category': category,
        'color': color,
        'style': style,
        'material': material,
        'status': status.name,
        'createdAt': createdAt.toIso8601String(),
      };
}
