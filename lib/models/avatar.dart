class Avatar {
  const Avatar({
    required this.id,
    required this.userId,
    required this.photoBindings,
    required this.faceShape,
    required this.hairstyle,
    required this.skinTone,
    required this.bodyProportion,
    required this.createdAt,
    this.isMock = true,
  });

  factory Avatar.fromJson(Map<String, dynamic> json) {
    return Avatar(
      id: json['id'] as String,
      userId: json['userId'] as String,
      photoBindings: Map<String, String>.from(
        json['photoBindings'] as Map<dynamic, dynamic>? ?? const {},
      ),
      faceShape: json['faceShape'] as String,
      hairstyle: json['hairstyle'] as String,
      skinTone: json['skinTone'] as String,
      bodyProportion: json['bodyProportion'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      isMock: json['isMock'] as bool? ?? true,
    );
  }

  final String id;
  final String userId;
  final Map<String, String> photoBindings;
  final String faceShape;
  final String hairstyle;
  final String skinTone;
  final String bodyProportion;
  final DateTime createdAt;
  final bool isMock;

  String? get primaryPhoto =>
      photoBindings['front'] ?? photoBindings.values.firstOrNull;

  Map<String, dynamic> toJson() => {
        'id': id,
        'userId': userId,
        'photoBindings': photoBindings,
        'faceShape': faceShape,
        'hairstyle': hairstyle,
        'skinTone': skinTone,
        'bodyProportion': bodyProportion,
        'createdAt': createdAt.toIso8601String(),
        'isMock': isMock,
      };
}
