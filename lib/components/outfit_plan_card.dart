import 'package:flutter/material.dart';

import '../models/outfit_plan.dart';
import '../models/outfit_look.dart';
import '../models/product.dart';
import 'product_image.dart';

class OutfitPlanCard extends StatelessWidget {
  const OutfitPlanCard({
    required this.plan,
    required this.favorite,
    required this.onFavorite,
    this.onTryOn,
    required this.onProductTap,
    this.onReplaceCategory,
    this.onRegenerate,
    this.isRegenerating = false,
    this.isTryOnLoading = false,
    super.key,
  });

  final OutfitPlan plan;
  final bool favorite;
  final VoidCallback onFavorite;
  final VoidCallback? onTryOn;
  final ValueChanged<Product> onProductTap;
  final ValueChanged<String>? onReplaceCategory;
  final VoidCallback? onRegenerate;
  final bool isRegenerating;
  final bool isTryOnLoading;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF17382A), Color(0xFF42644E)],
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2629222C),
            blurRadius: 22,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.auto_awesome_rounded,
                color: Color(0xFFDDE8D9),
                size: 20,
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'AI 推荐 Look',
                  style: TextStyle(
                    color: Color(0xFFDDE8D9),
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.6,
                  ),
                ),
              ),
              IconButton(
                key: const Key('favorite-outfit-plan'),
                tooltip: favorite ? '取消收藏方案' : '收藏方案',
                onPressed: onFavorite,
                icon: Icon(
                  favorite
                      ? Icons.favorite_rounded
                      : Icons.favorite_border_rounded,
                  color: favorite ? const Color(0xFFFF8598) : Colors.white,
                ),
              ),
            ],
          ),
          Text(
            plan.title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              height: 1.25,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _PlanBadge(icon: Icons.place_outlined, label: plan.scene),
              if (plan.styleDirection.trim().isNotEmpty)
                _PlanBadge(
                  key: Key('style-direction-${plan.lookId}'),
                  icon: Icons.palette_outlined,
                  label: plan.styleDirection,
                ),
              _PlanBadge(
                icon: Icons.bolt_rounded,
                label: '匹配度 ${plan.matchScore.clamp(0, 100)}%',
              ),
            ],
          ),
          const SizedBox(height: 9),
          Text(
            plan.reason,
            style: const TextStyle(
              color: Color(0xFFD8D1DA),
              fontSize: 12.5,
              height: 1.55,
            ),
          ),
          if (plan.accessoryDecisions.isNotEmpty) ...[
            const SizedBox(height: 14),
            _StylingAdvice(
              key: Key('styling-advice-${plan.lookId}'),
              decisions: plan.accessoryDecisions,
            ),
          ],
          const SizedBox(height: 16),
          for (final product in plan.products)
            _PlanProductRow(
              product: product,
              onTap: () => onProductTap(product),
              onReplace: onReplaceCategory == null
                  ? null
                  : () => onReplaceCategory!(product.wardrobeSlot),
            ),
          const SizedBox(height: 12),
          if (onRegenerate != null) ...[
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    key: const Key('regenerate-outfit-plan'),
                    onPressed: isRegenerating ? null : onRegenerate,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: BorderSide(
                        color: Colors.white.withValues(alpha: 0.35),
                      ),
                    ),
                    icon: isRegenerating
                        ? const SizedBox.square(
                            dimension: 15,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.refresh_rounded, size: 18),
                    label: Text(isRegenerating ? '正在换一套...' : '换一套'),
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: OutlinedButton.icon(
                    key: const Key('save-outfit-plan'),
                    onPressed: onFavorite,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: BorderSide(
                        color: Colors.white.withValues(alpha: 0.35),
                      ),
                    ),
                    icon: Icon(
                      favorite
                          ? Icons.bookmark_rounded
                          : Icons.bookmark_border_rounded,
                      size: 18,
                    ),
                    label: Text(favorite ? '已保存' : '保存方案'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 9),
          ],
          if (onTryOn != null)
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                key: const Key('try-on-outfit-plan'),
                onPressed: isTryOnLoading ? null : onTryOn,
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: const Color(0xFF29242D),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(15),
                  ),
                ),
                icon: isTryOnLoading
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.accessibility_new_rounded, size: 19),
                label: Text(
                  isTryOnLoading ? '正在准备 3D 试穿...' : '进入 3D 虚拟试穿',
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _StylingAdvice extends StatelessWidget {
  const _StylingAdvice({required this.decisions, super.key});

  final List<AccessoryDecision> decisions;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '造型建议',
            style: TextStyle(
              color: Colors.white,
              fontSize: 12.5,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 7),
          for (final decision in decisions)
            Padding(
              key: Key('accessory-decision-${decision.category}'),
              padding: const EdgeInsets.only(bottom: 5),
              child: Text(
                decision.include
                    ? '✓ ${decision.label}（${decision.reason}）'
                    : '本套 Look 无需${decision.label}，${decision.reason}',
                style: const TextStyle(
                  color: Color(0xFFE9E3EA),
                  fontSize: 11.5,
                  height: 1.45,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PlanProductRow extends StatelessWidget {
  const _PlanProductRow({
    required this.product,
    required this.onTap,
    this.onReplace,
  });

  final Product product;
  final VoidCallback onTap;
  final VoidCallback? onReplace;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: InkWell(
        key: Key('plan-product-${product.id}'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 62,
                height: 76,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                ),
                clipBehavior: Clip.antiAlias,
                child: ProductImage(product: product, fit: BoxFit.cover),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          '${_slotLabel(product.wardrobeSlot)} · ${product.brand}',
                          style: const TextStyle(
                            color: Color(0xFFBFB5C5),
                            fontSize: 10.5,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const Spacer(),
                        Text(
                          product.displayPrice,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      product.name,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      product.aiReason,
                      style: const TextStyle(
                        color: Color(0xFFD5CED8),
                        fontSize: 10.5,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        TextButton.icon(
                          onPressed: onTap,
                          style: TextButton.styleFrom(
                            foregroundColor: Colors.white,
                            padding: EdgeInsets.zero,
                            visualDensity: VisualDensity.compact,
                          ),
                          icon:
                              const Icon(Icons.shopping_bag_outlined, size: 14),
                          label: const Text(
                            '查看商品 / 购买',
                            style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        if (onReplace != null) ...[
                          const Spacer(),
                          TextButton.icon(
                            key: Key('replace-${product.wardrobeSlot}'),
                            onPressed: onReplace,
                            style: TextButton.styleFrom(
                              foregroundColor: const Color(0xFFE9DBF2),
                              visualDensity: VisualDensity.compact,
                            ),
                            icon:
                                const Icon(Icons.swap_horiz_rounded, size: 14),
                            label: Text(
                              '换${_placement(product.wardrobeSlot)}',
                              style: const TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _placement(String slot) {
    return switch (slot) {
      ProductCategory.top => '上衣',
      ProductCategory.bottom => '裤子',
      ProductCategory.shoes => '鞋',
      _ => '商品',
    };
  }

  String _slotLabel(String slot) {
    return switch (slot) {
      ProductCategory.top => '上衣',
      ProductCategory.bottom => '下装',
      ProductCategory.shoes => '鞋履',
      _ => slot,
    };
  }
}

class _PlanBadge extends StatelessWidget {
  const _PlanBadge({required this.icon, required this.label, super.key});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: const Color(0xFFE9DBF2)),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFFE9DBF2),
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}
