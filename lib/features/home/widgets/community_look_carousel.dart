import 'package:flutter/material.dart';

import '../../../components/outfit_post_card.dart';
import '../../../models/community_engagement.dart';
import '../../../models/outfit_post.dart';

class CommunityLookCarousel extends StatelessWidget {
  const CommunityLookCarousel({
    required this.posts,
    required this.engagement,
    required this.onFavorite,
    required this.onLike,
    required this.onComment,
    required this.onFollow,
    required this.onOpen,
    this.onTryOn,
    super.key,
  });

  final List<OutfitPost> posts;
  final CommunityEngagement engagement;
  final ValueChanged<OutfitPost> onFavorite;
  final ValueChanged<OutfitPost> onLike;
  final ValueChanged<OutfitPost> onComment;
  final ValueChanged<OutfitPost> onFollow;
  final ValueChanged<OutfitPost> onOpen;
  final ValueChanged<OutfitPost>? onTryOn;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 720,
      child: ListView.separated(
        key: const Key('community-hot-look-carousel'),
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        itemCount: posts.length,
        separatorBuilder: (_, __) => const SizedBox(width: 14),
        itemBuilder: (context, index) {
          final post = posts[index];
          return SizedBox(
            width: 330,
            child: OutfitPostCard(
              post: post,
              actionKeyPrefix: 'community-',
              favorite: engagement.savedPostIds.contains(post.id),
              liked: engagement.likedPostIds.contains(post.id),
              following: engagement.followedAuthors.contains(post.user),
              commentCount: engagement.commentCounts[post.id],
              onFavorite: () => onFavorite(post),
              onLike: () => onLike(post),
              onComment: () => onComment(post),
              onFollow: () => onFollow(post),
              onOpen: () => onOpen(post),
              onTryOn: onTryOn == null ? null : () => onTryOn!(post),
            ),
          );
        },
      ),
    );
  }
}
