import 'package:flutter/material.dart';

import '../models/product.dart';
import 'product_card.dart';

class OutfitSwapCarousel extends StatefulWidget {
  const OutfitSwapCarousel({
    required this.products,
    required this.selectedProductId,
    required this.onSelected,
    super.key,
  });

  final List<Product> products;
  final String? selectedProductId;
  final ValueChanged<Product> onSelected;

  @override
  State<OutfitSwapCarousel> createState() => _OutfitSwapCarouselState();
}

class _OutfitSwapCarouselState extends State<OutfitSwapCarousel> {
  late final PageController _controller;
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = _selectedIndex();
    _controller = PageController(
      initialPage: _currentIndex,
      viewportFraction: 0.48,
    );
  }

  @override
  void didUpdateWidget(covariant OutfitSwapCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextIndex = _selectedIndex();
    if (nextIndex != _currentIndex && _controller.hasClients) {
      _currentIndex = nextIndex;
      _controller.animateToPage(
        nextIndex,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  int _selectedIndex() {
    final index = widget.products.indexWhere(
      (product) => product.id == widget.selectedProductId,
    );
    return index < 0 ? 0 : index;
  }

  @override
  Widget build(BuildContext context) {
    if (widget.products.isEmpty) {
      return const SizedBox(
        height: 120,
        child: Center(child: Text('当前分类暂无可替换商品')),
      );
    }
    return SizedBox(
      key: const Key('outfit-swap-carousel'),
      height: 315,
      child: PageView.builder(
        controller: _controller,
        padEnds: false,
        itemCount: widget.products.length,
        onPageChanged: (index) {
          _currentIndex = index;
          widget.onSelected(widget.products[index]);
        },
        itemBuilder: (context, index) {
          final product = widget.products[index];
          return Padding(
            padding: const EdgeInsets.only(right: 12),
            child: ProductCard(
              product: product,
              selected: product.id == widget.selectedProductId,
              compact: true,
              onTap: () => widget.onSelected(product),
            ),
          );
        },
      ),
    );
  }
}
