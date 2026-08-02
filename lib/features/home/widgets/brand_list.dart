import 'package:flutter/material.dart';

import '../../../models/brand.dart';

class FeaturedBrandList extends StatelessWidget {
  const FeaturedBrandList({
    required this.brands,
    this.onBrandTap,
    super.key,
  });

  final List<Brand> brands;
  final ValueChanged<Brand>? onBrandTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 104,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: brands.length,
        separatorBuilder: (_, __) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final brand = brands[index];

          return Semantics(
            button: true,
            label: '查看 ${brand.name} 穿搭灵感',
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: onBrandTap == null ? null : () => onBrandTap!(brand),
              child: Container(
                width: 104,
                padding: const EdgeInsets.all(13),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFFECE9E5)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 39,
                      height: 39,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: _backgrounds[index % _backgrounds.length],
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        brand.shortName,
                        style: TextStyle(
                          color: _foregrounds[index % _foregrounds.length],
                          fontSize: brand.shortName.length > 1 ? 12 : 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const Spacer(),
                    Text(
                      brand.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF302E2B),
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  static const _backgrounds = [
    Color(0xFFF2ECE8),
    Color(0xFFE9ECED),
    Color(0xFFE7EBF0),
    Color(0xFFF0EDE8),
    Color(0xFFEAE4DC),
  ];

  static const _foregrounds = [
    Color(0xFF9A3D2D),
    Color(0xFF273238),
    Color(0xFF26384D),
    Color(0xFF201E1B),
    Color(0xFF24384A),
  ];
}
