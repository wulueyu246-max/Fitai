import 'outfit_plan.dart';

class AIRecommendationRecord {
  const AIRecommendationRecord({
    required this.id,
    required this.scene,
    required this.bodyAnalysis,
    required this.style,
    required this.outfitPlan,
    required this.createdTime,
  });

  factory AIRecommendationRecord.fromJson(Map<String, dynamic> json) {
    return AIRecommendationRecord(
      id: json['id'] as String,
      scene: json['scene'] as String,
      bodyAnalysis: json['bodyAnalysis'] as String,
      style: json['style'] as String,
      outfitPlan: OutfitPlan.fromJson(
        json['outfitPlan'] as Map<String, dynamic>,
      ),
      createdTime: DateTime.parse(json['createdTime'] as String),
    );
  }

  final String id;
  final String scene;
  final String bodyAnalysis;
  final String style;
  final OutfitPlan outfitPlan;
  final DateTime createdTime;

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'scene': scene,
      'bodyAnalysis': bodyAnalysis,
      'style': style,
      'outfitPlan': outfitPlan.toJson(),
      'createdTime': createdTime.toIso8601String(),
    };
  }
}
