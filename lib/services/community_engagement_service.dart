import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/community_engagement.dart';

class CommunityEngagementService {
  CommunityEngagementService({SharedPreferencesAsync? storage})
      : _storage = storage;

  static const _key = 'fitai.community.engagement.v1';
  SharedPreferencesAsync? _storage;
  CommunityEngagement _state = const CommunityEngagement(
    likedPostIds: {},
    savedPostIds: {},
    followedAuthors: {},
    commentCounts: {},
  );

  CommunityEngagement get state => _state;

  Future<CommunityEngagement> load() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final value = await storage.getString(_key);
      if (value != null) {
        final json = jsonDecode(value);
        if (json is Map<String, dynamic>) {
          _state = CommunityEngagement.fromJson(json);
        }
      }
    } catch (_) {
      // The local in-memory community state remains available.
    }
    return _state;
  }

  Future<CommunityEngagement> toggleLike(String postId) {
    return _toggle(postId, _state.likedPostIds, liked: true);
  }

  Future<CommunityEngagement> toggleSave(String postId) {
    return _toggle(postId, _state.savedPostIds, liked: false);
  }

  Future<CommunityEngagement> toggleFollow(String author) async {
    final authors = Set<String>.from(_state.followedAuthors);
    authors.contains(author) ? authors.remove(author) : authors.add(author);
    _state = CommunityEngagement(
      likedPostIds: _state.likedPostIds,
      savedPostIds: _state.savedPostIds,
      followedAuthors: authors,
      commentCounts: _state.commentCounts,
    );
    await _save();
    return _state;
  }

  Future<CommunityEngagement> addComment(String postId) async {
    final comments = Map<String, int>.from(_state.commentCounts);
    comments[postId] = (comments[postId] ?? 0) + 1;
    _state = CommunityEngagement(
      likedPostIds: _state.likedPostIds,
      savedPostIds: _state.savedPostIds,
      followedAuthors: _state.followedAuthors,
      commentCounts: comments,
    );
    await _save();
    return _state;
  }

  Future<CommunityEngagement> _toggle(
    String postId,
    Set<String> current, {
    required bool liked,
  }) async {
    final updated = Set<String>.from(current);
    updated.contains(postId) ? updated.remove(postId) : updated.add(postId);
    _state = CommunityEngagement(
      likedPostIds: liked ? updated : _state.likedPostIds,
      savedPostIds: liked ? _state.savedPostIds : updated,
      followedAuthors: _state.followedAuthors,
      commentCounts: _state.commentCounts,
    );
    await _save();
    return _state;
  }

  Future<void> _save() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setString(_key, jsonEncode(_state.toJson()));
    } catch (_) {
      // Community actions still update optimistically in memory.
    }
  }
}
