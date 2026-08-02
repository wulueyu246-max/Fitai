import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../../models/product.dart';
import '../models/share_outfit.dart';

class ShareOutfitCard extends StatelessWidget {
  const ShareOutfitCard({required this.outfit, super.key});

  final ShareOutfit outfit;

  @override
  Widget build(BuildContext context) {
    final plan = outfit.outfitPlan;
    final avatarBytes = _decodeAvatar(outfit.avatarBase64);
    return AspectRatio(
      aspectRatio: 4 / 5,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF17141B), Color(0xFF564762)],
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 35,
                    height: 35,
                    clipBehavior: Clip.antiAlias,
                    decoration: const BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                    ),
                    child: avatarBytes == null
                        ? const Center(
                            child: Text(
                              'F',
                              style: TextStyle(
                                color: Color(0xFF211D24),
                                fontWeight: FontWeight.w900,
                                fontSize: 18,
                              ),
                            ),
                          )
                        : Image.memory(avatarBytes, fit: BoxFit.cover),
                  ),
                  const SizedBox(width: 10),
                  const Text(
                    '树皮 Shupi',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    outfit.userName,
                    style: const TextStyle(
                      color: Color(0xFFDCD3E0),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              Text(
                plan.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 25,
                  height: 1.2,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                plan.reason,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFFE1D9E4),
                  fontSize: 12,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 18),
              Expanded(
                child: Row(
                  children: [
                    for (final product in plan.products) ...[
                      Expanded(
                        child: _ShareProduct(product: product),
                      ),
                      if (product != plan.products.last)
                        const SizedBox(width: 8),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 18),
              const Row(
                children: [
                  Icon(
                    Icons.auto_awesome_rounded,
                    color: Color(0xFFD8C2E4),
                    size: 16,
                  ),
                  SizedBox(width: 7),
                  Text(
                    'AI理解你，也懂你的风格',
                    style: TextStyle(
                      color: Color(0xFFF1EAF4),
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Spacer(),
                  Text(
                    '#树皮穿搭',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Uint8List? _decodeAvatar(String? value) {
    if (value == null || value.isEmpty) {
      return null;
    }
    try {
      return base64Decode(value);
    } catch (_) {
      return null;
    }
  }
}

class _ShareProduct extends StatelessWidget {
  const _ShareProduct({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFF9F7FA),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(11),
                child: Container(
                  width: double.infinity,
                  color: Colors.white,
                  child: product.isNetworkImage
                      ? Image.network(product.imageUrl, fit: BoxFit.contain)
                      : Image.asset(product.imageUrl, fit: BoxFit.contain),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              product.brand,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFF776580),
                fontSize: 9,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              product.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFF242126),
                fontSize: 10,
                height: 1.2,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
