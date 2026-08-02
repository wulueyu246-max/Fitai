class CommunityEngagement {
  const CommunityEngagement({
    required this.likedPostIds,
    required this.savedPostIds,
    required this.followedAuthors,
    required this.commentCounts,
  });

  factory CommunityEngagement.fromJson(Map<String, dynamic> json) {
    Set<String> readSet(String key) {
      return (json[key] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toSet();
    }

    return CommunityEngagement(
      likedPostIds: readSet('likedPostIds'),
      savedPostIds: readSet('savedPostIds'),
      followedAuthors: readSet('followedAuthors'),
      commentCounts: Map<String, int>.from(
        json['commentCounts'] as Map<dynamic, dynamic>? ?? const {},
      ),
    );
  }

  final Set<String> likedPostIds;
  final Set<String> savedPostIds;
  final Set<String> followedAuthors;
  final Map<String, int> commentCounts;

  Map<String, dynamic> toJson() {
    return {
      'likedPostIds': likedPostIds.toList(),
      'savedPostIds': savedPostIds.toList(),
      'followedAuthors': followedAuthors.toList(),
      'commentCounts': commentCounts,
    };
  }
}
