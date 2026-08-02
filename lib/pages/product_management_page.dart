import 'package:flutter/material.dart';

import '../components/product_image.dart';
import '../models/product.dart';
import '../repositories/mock_product_repository.dart';
import '../repositories/product_repository.dart';
import 'product_detail_page.dart';

class ProductManagementPage extends StatefulWidget {
  const ProductManagementPage({this.repository, super.key});

  final ProductRepository? repository;

  @override
  State<ProductManagementPage> createState() => _ProductManagementPageState();
}

class _ProductManagementPageState extends State<ProductManagementPage> {
  late final ProductRepository _repository;
  final _searchController = TextEditingController();
  List<Product> _products = const [];
  String? _category;
  bool _loading = true;
  String? _error;
  final Set<String> _updating = {};

  @override
  void initState() {
    super.initState();
    _repository = widget.repository ?? MockProductRepository.instance;
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final products = await _repository.listProducts(
        includeUnavailable: true,
      );
      if (mounted) {
        setState(() {
          _products = products;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = '商品数据库读取失败，请稍后重试';
        });
      }
    }
  }

  List<Product> get _visibleProducts {
    final query = _searchController.text.trim().toLowerCase();
    return _products.where((product) {
      if (_category != null && product.category != _category) return false;
      if (query.isEmpty) return true;
      return '${product.brand} ${product.name} ${product.id} ${product.sku}'
          .toLowerCase()
          .contains(query);
    }).toList(growable: false);
  }

  Future<void> _setAvailability(Product product, bool value) async {
    if (_updating.contains(product.id)) return;
    setState(() => _updating.add(product.id));
    try {
      await _repository.setAvailability(product.id, value);
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('商品状态保存失败，请重试')),
        );
      }
    } finally {
      if (mounted) setState(() => _updating.remove(product.id));
    }
  }

  void _openDetail(Product product) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProductDetailPage(product: product, trackOpen: false),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visibleProducts;
    final available = _products.where((item) => item.isAvailable).length;
    return Scaffold(
      backgroundColor: const Color(0xFFF6F1E8),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF6F1E8),
        title: const Text('商品管理'),
        actions: [
          IconButton(
            key: const Key('refresh-product-database'),
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: '刷新',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorState(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: CustomScrollView(
                    key: const Key('product-management-page'),
                    slivers: [
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(18, 10, 18, 14),
                        sliver: SliverToBoxAdapter(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Mock 商品数据库',
                                style: TextStyle(
                                  fontSize: 24,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                '共 ${_products.length} 件 · 已上架 $available 件 · '
                                '当前状态仅用于测试，未来由云端商品表接管。',
                                style: const TextStyle(
                                  color: Color(0xFF746B62),
                                  height: 1.45,
                                ),
                              ),
                              const SizedBox(height: 16),
                              TextField(
                                key: const Key('product-database-search'),
                                controller: _searchController,
                                onChanged: (_) => setState(() {}),
                                decoration: InputDecoration(
                                  hintText: '搜索品牌、商品、ID 或 SKU',
                                  prefixIcon: const Icon(Icons.search),
                                  suffixIcon: _searchController.text.isEmpty
                                      ? null
                                      : IconButton(
                                          onPressed: () {
                                            _searchController.clear();
                                            setState(() {});
                                          },
                                          icon: const Icon(Icons.close),
                                        ),
                                  filled: true,
                                  fillColor: Colors.white,
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(16),
                                    borderSide: BorderSide.none,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 12),
                              SingleChildScrollView(
                                scrollDirection: Axis.horizontal,
                                child: Row(
                                  children: [
                                    _FilterChip(
                                      label: '全部',
                                      selected: _category == null,
                                      onSelected: () =>
                                          setState(() => _category = null),
                                    ),
                                    for (final category
                                        in ProductCategory.catalogValues)
                                      _FilterChip(
                                        label: category,
                                        selected: _category == category,
                                        onSelected: () => setState(
                                          () => _category = category,
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      if (visible.isEmpty)
                        const SliverFillRemaining(
                          hasScrollBody: false,
                          child: Center(child: Text('没有匹配的商品')),
                        )
                      else
                        SliverPadding(
                          padding: const EdgeInsets.fromLTRB(18, 0, 18, 36),
                          sliver: SliverList.separated(
                            itemCount: visible.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 12),
                            itemBuilder: (context, index) {
                              final product = visible[index];
                              return _ProductManagementTile(
                                product: product,
                                updating: _updating.contains(product.id),
                                onTap: () => _openDetail(product),
                                onAvailabilityChanged: (value) =>
                                    _setAvailability(product, value),
                              );
                            },
                          ),
                        ),
                    ],
                  ),
                ),
    );
  }
}

class _ProductManagementTile extends StatelessWidget {
  const _ProductManagementTile({
    required this.product,
    required this.updating,
    required this.onTap,
    required this.onAvailabilityChanged,
  });

  final Product product;
  final bool updating;
  final VoidCallback onTap;
  final ValueChanged<bool> onAvailabilityChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 86,
                height: 104,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: ProductImage(product: product, fit: BoxFit.cover),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.brand,
                      style: const TextStyle(
                        color: Color(0xFF315C47),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      product.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '${product.displayPrice} · ${product.category} · ${product.color}',
                      style: const TextStyle(color: Color(0xFF6F685F)),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      product.sku,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF948C83),
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                children: [
                  Text(
                    product.isAvailable ? '已上架' : '已下架',
                    style: TextStyle(
                      color: product.isAvailable
                          ? const Color(0xFF315C47)
                          : const Color(0xFFA23B32),
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Switch.adaptive(
                    key: Key('availability-${product.id}'),
                    value: product.isAvailable,
                    onChanged: updating ? null : onAvailabilityChanged,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onSelected(),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.inventory_2_outlined, size: 44),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 14),
            OutlinedButton(onPressed: onRetry, child: const Text('重新加载')),
          ],
        ),
      ),
    );
  }
}
