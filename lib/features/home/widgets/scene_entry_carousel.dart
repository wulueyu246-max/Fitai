import 'package:flutter/material.dart';

import '../models/fashion_feed.dart';

class SceneEntryCarousel extends StatelessWidget {
  const SceneEntryCarousel({
    required this.scenes,
    required this.selectedScene,
    required this.onSelected,
    super.key,
  });

  final List<FashionScene> scenes;
  final String selectedScene;
  final ValueChanged<FashionScene> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 146,
      child: ListView.separated(
        key: const Key('fashion-scene-carousel'),
        scrollDirection: Axis.horizontal,
        clipBehavior: Clip.none,
        itemCount: scenes.length,
        separatorBuilder: (_, __) => const SizedBox(width: 11),
        itemBuilder: (context, index) {
          final scene = scenes[index];
          final selected = scene.title == selectedScene;
          return InkWell(
            key: Key('scene-${scene.id}'),
            borderRadius: BorderRadius.circular(21),
            onTap: () => onSelected(scene),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutCubic,
              width: 122,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(21),
                border: Border.all(
                  color:
                      selected ? const Color(0xFF244C3A) : Colors.transparent,
                  width: 2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: selected
                        ? const Color(0x28655470)
                        : const Color(0x151E1915),
                    blurRadius: selected ? 20 : 12,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Image.asset(
                    scene.imageAsset,
                    fit: BoxFit.cover,
                    alignment: Alignment.topCenter,
                    cacheWidth: 366,
                    frameBuilder: (context, child, frame, synchronous) {
                      return AnimatedOpacity(
                        opacity: synchronous || frame != null ? 1 : 0,
                        duration: const Duration(milliseconds: 280),
                        child: child,
                      );
                    },
                  ),
                  const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Color(0x05000000), Color(0xD8000000)],
                        stops: [0.35, 1],
                      ),
                    ),
                  ),
                  Positioned(
                    left: 12,
                    right: 10,
                    bottom: 12,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          scene.title,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          scene.subtitle,
                          style: const TextStyle(
                            color: Color(0xFFE2DEE4),
                            fontSize: 10.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
