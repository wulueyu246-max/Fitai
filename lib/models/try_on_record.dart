import 'outfit_plan.dart';

class TryOnRecord {
  const TryOnRecord({
    required this.id,
    required this.userId,
    required this.imageUrl,
    required this.outfitPlan,
    required this.createdTime,
    this.isMock = false,
  });

  factory TryOnRecord.fromJson(Map<String, dynamic> json) {
    return TryOnRecord(
      id: json['id'] as String,
      userId: json['userId'] as String,
      imageUrl: json['imageUrl'] as String,
      outfitPlan: OutfitPlan.fromJson(
        json['outfitPlan'] as Map<String, dynamic>,
      ),
      createdTime: DateTime.parse(json['createdTime'] as String),
      isMock: json['isMock'] as bool? ?? false,
    );
  }

  final String id;
  final String userId;
  final String imageUrl;
  final OutfitPlan outfitPlan;
  final DateTime createdTime;
  final bool isMock;

  bool get isNetworkImage {
    final uri = Uri.tryParse(imageUrl);
    return uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'userId': userId,
      'imageUrl': imageUrl,
      'outfitPlan': outfitPlan.toJson(),
      'createdTime': createdTime.toIso8601String(),
      'isMock': isMock,
    };
  }
}
