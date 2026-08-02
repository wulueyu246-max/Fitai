import 'package:flutter/material.dart';

import '../models/outfit_post.dart';

class OutfitPostCard extends StatelessWidget {
  const OutfitPostCard({
    required this.post,
    required this.favorite,
    required this.onFavorite,
    required this.onOpen,
    this.liked = false,
    this.following = false,
    this.commentCount,
    this.onLike,
    this.onComment,
    this.onFollow,
    this.onTryOn,
    this.actionKeyPrefix = '',
    super.key,
  });

  final OutfitPost post;
  final bool favorite;
  final VoidCallback onFavorite;
  final VoidCallback onOpen;
  final bool liked;
  final bool following;
  final int? commentCount;
  final VoidCallback? onLike;
  final VoidCallback? onComment;
  final VoidCallback? onFollow;
  final VoidCallback? onTryOn;
  final String actionKeyPrefix;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        boxShadow: const [
          BoxShadow(
            color: Color(0x101D1813),
            blurRadius: 22,
            offset: Offset(0, 8),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 4 / 5,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.asset(
                  post.image,
                  fit: BoxFit.cover,
                  alignment: Alignment.topCenter,
                  cacheWidth: 700,
                  frameBuilder: (context, child, frame, synchronous) {
                    return AnimatedOpacity(
                      opacity: synchronous || frame != null ? 1 : 0,
                      duration: const Duration(milliseconds: 320),
                      child: child,
                    );
                  },
                ),
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Colors.transparent, Color(0xB8000000)],
                      stops: [0.58, 1],
                    ),
                  ),
                ),
                Positioned(
                  left: 12,
                  right: 10,
                  bottom: 10,
                  child: Row(
                    children: [
                      const CircleAvatar(
                        radius: 13,
                        backgroundColor: Color(0xFFE8E1EC),
                        child: Icon(
                          Icons.person_rounded,
                          size: 15,
                          color: Color(0xFF685774),
                        ),
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: Text(
                          post.user,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      InkWell(
                        key: Key('${actionKeyPrefix}follow-author-${post.id}'),
                        onTap: onFollow,
                        borderRadius: BorderRadius.circular(999),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 7,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: following
                                ? const Color(0xFFDCCEE3)
                                : const Color(0x33FFFFFF),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            following ? '已关注' : '关注',
                            style: TextStyle(
                              color: following
                                  ? const Color(0xFF44364B)
                                  : Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                      IconButton(
                        key: Key('${actionKeyPrefix}favorite-post-${post.id}'),
                        tooltip: favorite ? '取消收藏' : '收藏穿搭',
                        visualDensity: VisualDensity.compact,
                        onPressed: onFavorite,
                        icon: Icon(
                          favorite
                              ? Icons.favorite_rounded
                              : Icons.favorite_border_rounded,
                          color:
                              favorite ? const Color(0xFFFF8BA0) : Colors.white,
                          size: 20,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(13, 12, 13, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  post.title,
                  style: const TextStyle(
                    color: Color(0xFF211F1D),
                    fontSize: 15,
                    height: 1.35,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'AI推荐 · ${post.description}',
                  maxLines: 4,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF695C73),
                    fontSize: 11.5,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 5,
                  runSpacing: 5,
                  children: [
                    for (final product in post.products.take(2))
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 7,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF3EFF5),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          '${product.brand} · ${product.name}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xFF685A70),
                            fontSize: 8.5,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                for (final product in post.products.take(3))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${product.wardrobeSlot} · ${product.name}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF504A46),
                              fontSize: 9.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          product.displayPrice,
                          style: const TextStyle(
                            color: Color(0xFF241F24),
                            fontSize: 9.5,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 5),
                Wrap(
                  spacing: 9,
                  runSpacing: 3,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _EngagementButton(
                      key: Key('${actionKeyPrefix}like-post-${post.id}'),
                      icon: liked
                          ? Icons.favorite_rounded
                          : Icons.favorite_border_rounded,
                      label: _compactLikes(post.likes + (liked ? 1 : 0)),
                      active: liked,
                      onTap: onLike,
                    ),
                    _EngagementButton(
                      key: Key('${actionKeyPrefix}comment-post-${post.id}'),
                      icon: Icons.chat_bubble_outline_rounded,
                      label: '${post.comments + (commentCount ?? 0)}',
                      onTap: onComment,
                    ),
                    Text(
                      '${post.saves} 收藏',
                      style: const TextStyle(
                        color: Color(0xFF8A837D),
                        fontSize: 9,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    if (onTryOn != null) ...[
                      Expanded(
                        child: FilledButton(
                          key: Key('${actionKeyPrefix}try-on-look-${post.id}'),
                          onPressed: onTryOn,
                          style: FilledButton.styleFrom(
                            backgroundColor: const Color(0xFF244C3A),
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            visualDensity: VisualDensity.compact,
                          ),
                          child: const Text(
                            '立即试穿',
                            style: TextStyle(
                              fontSize: 9.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    Expanded(
                      child: OutlinedButton(
                        key: Key('${actionKeyPrefix}open-post-${post.id}'),
                        onPressed: onOpen,
                        style: OutlinedButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                        ),
                        child: const Text(
                          '查看商品',
                          style: TextStyle(
                            fontSize: 9.5,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _compactLikes(int likes) {
    return likes >= 10000
        ? '${(likes / 10000).toStringAsFixed(1)}万'
        : likes.toString();
  }
}

class _EngagementButton extends StatelessWidget {
  const _EngagementButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
    super.key,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(99),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 14,
              color: active ? const Color(0xFFC94257) : const Color(0xFF79716C),
            ),
            const SizedBox(width: 3),
            Text(
              label,
              style: TextStyle(
                color:
                    active ? const Color(0xFFC94257) : const Color(0xFF8A837D),
                fontSize: 9.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
