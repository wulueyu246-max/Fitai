import '../features/home/models/daily_fashion_context.dart';
import '../models/daily_outfit.dart';
import '../models/outfit_plan.dart';

abstract interface class DailyOutfitService {
  DailyOutfit generate({
    required DailyFashionContext context,
    required String scene,
    required OutfitPlan plan,
    required String aiReason,
  });
}

class LocalDailyOutfitService implements DailyOutfitService {
  const LocalDailyOutfitService();

  @override
  DailyOutfit generate({
    required DailyFashionContext context,
    required String scene,
    required OutfitPlan plan,
    required String aiReason,
  }) {
    final date =
        '${context.updatedAt.year}-${context.updatedAt.month}-${context.updatedAt.day}';
    return DailyOutfit(
      id: 'daily-$date-$scene',
      context: context,
      scene: scene,
      plan: plan,
      aiReason: aiReason,
      generatedAt: context.updatedAt,
    );
  }
}
