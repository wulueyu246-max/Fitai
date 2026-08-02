import '../features/home/models/daily_fashion_context.dart';
import 'outfit_plan.dart';

class DailyOutfit {
  const DailyOutfit({
    required this.id,
    required this.context,
    required this.scene,
    required this.plan,
    required this.aiReason,
    required this.generatedAt,
  });

  final String id;
  final DailyFashionContext context;
  final String scene;
  final OutfitPlan plan;
  final String aiReason;
  final DateTime generatedAt;
}
