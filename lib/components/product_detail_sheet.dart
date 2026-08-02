import 'package:flutter/material.dart';

import '../models/product.dart';

Future<void> showProductDetailSheet(
  BuildContext context, {
  required Product product,
  Future<void> Function()? onPurchaseIntent,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) {
      return FractionallySizedBox(
        heightFactor: 0.88,
        child: Material(
          color: const Color(0xFFF9F8F5),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          clipBehavior: Clip.antiAlias,
          child: SafeArea(
            top: false,
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 620),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Center(
                        child: Container(
                          width: 42,
                          height: 4,
                          decoration: BoxDecoration(
                            color: const Color(0xFFD5D1CB),
                            borderRadius: BorderRadius.circular(999),
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                      Row(
                        children: [
                          const Expanded(
                            child: Text(
                              '商品详情',
                              style: TextStyle(
                                color: Color(0xFF201E1C),
                                fontSize: 24,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          IconButton(
                            key: const Key('close-product-details'),
                            tooltip: '关闭',
                            onPressed: () => Navigator.pop(context),
                            icon: const Icon(Icons.close_rounded),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(22),
                        child: AspectRatio(
                          aspectRatio: 4 / 3,
                          child: product.isNetworkImage
                              ? Image.network(
                                  product.imageUrl,
                                  fit: BoxFit.cover,
                                )
                              : Image.asset(
                                  product.imageUrl,
                                  fit: BoxFit.cover,
                                  cacheWidth: 1200,
                                ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text(
                        product.brand,
                        style: const TextStyle(
                          color: Color(0xFF776580),
                          fontSize: 12,
                          letterSpacing: 0.7,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              product.name,
                              style: const TextStyle(
                                color: Color(0xFF201E1C),
                                fontSize: 23,
                                height: 1.3,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          const SizedBox(width: 16),
                          Text(
                            product.displayPrice,
                            style: const TextStyle(
                              color: Color(0xFF201E1C),
                              fontSize: 20,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _DetailTag(label: product.category),
                          _DetailTag(label: product.color),
                          _DetailTag(label: product.style),
                          _DetailTag(label: product.season),
                          _DetailTag(label: product.fitType),
                          _DetailTag(label: '尺码 ${product.size}'),
                          _DetailTag(label: product.material),
                          _DetailTag(
                            label: product.inStock
                                ? '库存 ${product.stock}'
                                : '暂时缺货',
                          ),
                        ],
                      ),
                      const SizedBox(height: 22),
                      const Text(
                        '商品说明',
                        style: TextStyle(
                          color: Color(0xFF292624),
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 7),
                      Text(
                        product.description,
                        style: const TextStyle(
                          color: Color(0xFF625D58),
                          fontSize: 14,
                          height: 1.6,
                        ),
                      ),
                      const SizedBox(height: 20),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEFEAF2),
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'AI 推荐理由',
                              style: TextStyle(
                                color: Color(0xFF665774),
                                fontSize: 13,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 7),
                            Text(
                              product.aiReason,
                              style: const TextStyle(
                                color: Color(0xFF4F4854),
                                fontSize: 14,
                                height: 1.6,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        '当前为商业流程 Demo，商品数据来自本地 Mock，暂不提供真实购买。',
                        style: TextStyle(
                          color: Color(0xFF8A837C),
                          fontSize: 11.5,
                          height: 1.5,
                        ),
                      ),
                      const SizedBox(height: 14),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          key: const Key('mock-buy-product'),
                          onPressed: product.inStock
                              ? () async {
                                  await onPurchaseIntent?.call();
                                  if (!context.mounted) {
                                    return;
                                  }
                                  ScaffoldMessenger.of(context)
                                    ..hideCurrentSnackBar()
                                    ..showSnackBar(
                                      SnackBar(
                                        content: Text(
                                          '已记录 ${product.brand} ${product.name} 的购买意向，真实商城链路尚未接入',
                                        ),
                                        behavior: SnackBarBehavior.floating,
                                      ),
                                    );
                                }
                              : null,
                          style: FilledButton.styleFrom(
                            backgroundColor: const Color(0xFF1D1B1F),
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          icon: const Icon(
                            Icons.shopping_bag_outlined,
                            size: 18,
                          ),
                          label: const Text(
                            '立即购买（Demo）',
                            style: TextStyle(fontWeight: FontWeight.w800),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}

class _DetailTag extends StatelessWidget {
  const _DetailTag({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFE4E0DA)),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF5D5752),
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
