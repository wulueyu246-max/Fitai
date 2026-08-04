import 'package:flutter/material.dart';

import '../components/outfit_plan_card.dart';
import '../components/product_card.dart';
import '../components/product_detail_sheet.dart';
import '../components/wardrobe_empty_state.dart';
import '../models/ai_recommendation_record.dart';
import '../models/outfit_plan.dart';
import '../models/product.dart';
import '../models/try_on_record.dart';
import '../models/wardrobe_snapshot.dart';
import '../repositories/wardrobe_repository.dart';

class WardrobePage extends StatefulWidget {
  const WardrobePage({this.repository, super.key});

  final WardrobeRepository? repository;

  @override
  State<WardrobePage> createState() => _WardrobePageState();
}

class _WardrobePageState extends State<WardrobePage> {
  late final WardrobeRepository _repository;
  WardrobeSnapshot? _snapshot;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _repository = widget.repository ?? LocalWardrobeRepository();
    _repository.changes.addListener(_reload);
    _reload();
  }

  @override
  void dispose() {
    _repository.changes.removeListener(_reload);
    super.dispose();
  }

  Future<void> _reload() async {
    try {
      final snapshot = await _repository.load();
      if (!mounted) {
        return;
      }
      setState(() {
        _snapshot = snapshot;
        _loading = false;
        _error = null;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _error = '衣柜加载失败，请稍后重试';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        backgroundColor: const Color(0xFFF7F6F3),
        appBar: AppBar(
          title: const Text(
            '我的衣柜',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          backgroundColor: const Color(0xFFF7F6F3),
          surfaceTintColor: Colors.transparent,
          bottom: const TabBar(
            tabs: [
              Tab(text: '我的收藏'),
              Tab(text: '我的穿搭'),
              Tab(text: '试穿记录'),
              Tab(text: 'AI建议'),
            ],
          ),
        ),
        body: AnimatedSwitcher(
          duration: const Duration(milliseconds: 280),
          child: _buildBody(),
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(
        key: ValueKey('wardrobe-loading'),
        child: CircularProgressIndicator(strokeWidth: 2.5),
      );
    }
    if (_error case final error?) {
      return Center(
        key: const ValueKey('wardrobe-error'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(error),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: _reload, child: const Text('重新加载')),
          ],
        ),
      );
    }

    final snapshot = _snapshot!;
    return TabBarView(
      key: const ValueKey('wardrobe-content'),
      children: [
        _FavoriteProductsTab(
          products: snapshot.favoriteProducts,
          onRemove: _repository.toggleProduct,
        ),
        _OutfitPlansTab(
          plans: snapshot.outfitPlans,
          onRemove: _repository.toggleOutfitPlan,
        ),
        _TryOnHistoryTab(records: snapshot.tryOnHistory),
        _AIRecommendationHistoryTab(
          records: snapshot.aiRecommendationHistory,
        ),
      ],
    );
  }
}

class _AIRecommendationHistoryTab extends StatelessWidget {
  const _AIRecommendationHistoryTab({required this.records});

  final List<AIRecommendationRecord> records;

  @override
  Widget build(BuildContext context) {
    if (records.isEmpty) {
      return const WardrobeEmptyState(
        icon: Icons.auto_awesome_outlined,
        title: '还没有历史 AI 建议',
        message: '每次生成专属穿搭方案后，身体分析、风格和完整 Look 会保存到这里。',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(18),
      itemCount: records.length,
      separatorBuilder: (_, __) => const SizedBox(height: 14),
      itemBuilder: (context, index) {
        final record = records[index];
        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            boxShadow: const [
              BoxShadow(
                color: Color(0x0C1D1814),
                blurRadius: 18,
                offset: Offset(0, 7),
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
                    color: Color(0xFF6A5B75),
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${record.scene} · ${record.style}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  Text(
                    '${record.createdTime.month}.${record.createdTime.day}',
                    style: const TextStyle(
                      color: Color(0xFF908983),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                record.bodyAnalysis,
                style: const TextStyle(
                  color: Color(0xFF625D58),
                  fontSize: 12.5,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                record.outfitPlan.products
                    .map((product) => product.name)
                    .join(' · '),
                style: const TextStyle(
                  color: Color(0xFF6D5C79),
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _FavoriteProductsTab extends StatelessWidget {
  const _FavoriteProductsTab({
    required this.products,
    required this.onRemove,
  });

  final List<Product> products;
  final ValueChanged<Product> onRemove;

  @override
  Widget build(BuildContext context) {
    if (products.isEmpty) {
      return const WardrobeEmptyState(
        icon: Icons.favorite_border_rounded,
        title: '还没有收藏商品',
        message: '在首页或 AI 穿搭方案中点击爱心，喜欢的商品会出现在这里。',
      );
    }
    return GridView.builder(
      padding: const EdgeInsets.all(18),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 260,
        mainAxisSpacing: 14,
        crossAxisSpacing: 14,
        childAspectRatio: 0.63,
      ),
      itemCount: products.length,
      itemBuilder: (context, index) {
        final product = products[index];
        return ProductCard(
          product: product,
          selected: false,
          compact: true,
          favorite: true,
          onFavorite: () => onRemove(product),
          onTap: () => showProductDetailSheet(context, product: product),
        );
      },
    );
  }
}

class _OutfitPlansTab extends StatelessWidget {
  const _OutfitPlansTab({
    required this.plans,
    required this.onRemove,
  });

  final List<OutfitPlan> plans;
  final ValueChanged<OutfitPlan> onRemove;

  @override
  Widget build(BuildContext context) {
    if (plans.isEmpty) {
      return const WardrobeEmptyState(
        icon: Icons.style_outlined,
        title: '还没有保存穿搭',
        message: '收藏 AI 推荐 Look，建立属于你的个人搭配库。',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(18),
      itemCount: plans.length,
      separatorBuilder: (_, __) => const SizedBox(height: 16),
      itemBuilder: (context, index) {
        final plan = plans[index];
        return OutfitPlanCard(
          plan: plan,
          favorite: true,
          onFavorite: () => onRemove(plan),
          onProductTap: (product) =>
              showProductDetailSheet(context, product: product),
          onTryOn: () {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('请从 AI 穿搭页携带用户照片进入试穿')),
            );
          },
        );
      },
    );
  }
}

class _TryOnHistoryTab extends StatelessWidget {
  const _TryOnHistoryTab({required this.records});

  final List<TryOnRecord> records;

  @override
  Widget build(BuildContext context) {
    if (records.isEmpty) {
      return const WardrobeEmptyState(
        icon: Icons.history_rounded,
        title: '还没有试穿记录',
        message: '生成 AI 模特效果后，历史结果会自动保存到这里。',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(18),
      itemCount: records.length,
      separatorBuilder: (_, __) => const SizedBox(height: 14),
      itemBuilder: (context, index) {
        return _TryOnHistoryCard(record: records[index]);
      },
    );
  }
}

class _TryOnHistoryCard extends StatelessWidget {
  const _TryOnHistoryCard({required this.record});

  final TryOnRecord record;

  @override
  Widget build(BuildContext context) {
    final image = record.isNetworkImage
        ? Image.network(record.imageUrl, fit: BoxFit.cover)
        : Image.asset(record.imageUrl, fit: BoxFit.cover);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: SizedBox(width: 92, height: 118, child: image),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  record.outfitPlan.title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  record.outfitPlan.products
                      .map((product) => product.name)
                      .join(' · '),
                  style: const TextStyle(
                    color: Color(0xFF716B66),
                    fontSize: 12,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  '${record.createdTime.year}.${record.createdTime.month}.${record.createdTime.day}',
                  style: const TextStyle(
                    color: Color(0xFF9A938D),
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
