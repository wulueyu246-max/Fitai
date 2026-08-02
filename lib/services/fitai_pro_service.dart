import '../models/fitai_pro_plan.dart';

class FitAIProService {
  const FitAIProService();

  List<FitAIProPlan> getPlans() {
    return const [
      FitAIProPlan(
        id: 'pro-monthly',
        name: 'FitAI Pro 月度',
        priceLabel: '¥29',
        billingLabel: '/月',
        recommended: true,
        benefits: [
          '无限 AI 穿搭方案',
          '高级 AI 数字人',
          '专属商品推荐',
          '私人数字衣橱',
          '每日 AI 搭配',
          '旅行多场景穿搭',
        ],
      ),
      FitAIProPlan(
        id: 'pro-yearly',
        name: 'FitAI Pro 年度',
        priceLabel: '¥238',
        billingLabel: '/年',
        benefits: [
          '包含全部 Pro 权益',
          '年度风格报告',
          '优先体验新模型',
          '品牌会员专属活动',
          '高级试穿生成队列',
        ],
      ),
    ];
  }

  FitAIProMembership getMembership() {
    return const FitAIProMembership(active: false);
  }

  FitAIEntitlements getEntitlements(FitAIProMembership membership) {
    return membership.active ? proEntitlements : freeEntitlements;
  }

  static const freeEntitlements = FitAIEntitlements(
    tier: FitAIMemberTier.free,
    dailyAiLimit: 3,
    advancedAnalysis: false,
    advancedTryOn: false,
    privateWardrobe: true,
    premiumAvatar: false,
  );

  static const proEntitlements = FitAIEntitlements(
    tier: FitAIMemberTier.pro,
    dailyAiLimit: 999,
    advancedAnalysis: true,
    advancedTryOn: true,
    privateWardrobe: true,
    premiumAvatar: true,
  );
}
