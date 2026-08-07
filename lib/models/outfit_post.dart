import 'product.dart';

class OutfitPost {
  const OutfitPost({
    required this.id,
    required this.user,
    required this.image,
    required this.title,
    required this.description,
    required this.products,
    required this.likes,
    required this.createdAt,
    this.requestId = '',
    this.gender = 'unisex',
    this.style = '',
    this.scene = '',
    this.imageSource = '',
    this.authorId = '',
    this.comments = 0,
    this.saves = 0,
  });

  factory OutfitPost.fromJson(Map<String, dynamic> json) {
    return OutfitPost(
      id: json['id'] as String,
      user: json['user'] as String,
      image: json['image'] as String,
      title: json['title'] as String,
      description: json['description'] as String,
      products: (json['products'] as List<dynamic>)
          .map((item) => Product.fromJson(item as Map<String, dynamic>))
          .toList(growable: false),
      likes: json['likes'] as int,
      requestId:
          (json['request_id'] ?? json['requestId'])?.toString().trim() ?? '',
      gender: _normalizeGender(json['gender'] as String?),
      style: json['style']?.toString().trim() ?? '',
      scene: json['scene']?.toString().trim() ?? '',
      imageSource:
          (json['image_source'] ?? json['imageSource'])?.toString().trim() ??
              '',
      authorId: json['authorId'] as String? ?? '',
      comments: json['comments'] as int? ?? 0,
      saves: json['saves'] as int? ?? 0,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String user;
  final String image;
  final String title;
  final String description;
  final List<Product> products;
  final int likes;
  final String requestId;
  final String gender;
  final String style;
  final String scene;
  final String imageSource;
  final String authorId;
  final int comments;
  final int saves;
  final DateTime createdAt;

  OutfitPost copyWith({
    int? likes,
    int? comments,
    int? saves,
  }) {
    return OutfitPost(
      id: id,
      user: user,
      authorId: authorId,
      image: image,
      title: title,
      description: description,
      products: products,
      likes: likes ?? this.likes,
      requestId: requestId,
      gender: gender,
      style: style,
      scene: scene,
      imageSource: imageSource,
      comments: comments ?? this.comments,
      saves: saves ?? this.saves,
      createdAt: createdAt,
    );
  }

  bool matchesCurrentResult({
    required String requestId,
    required String gender,
  }) {
    final expectedRequestId = requestId.trim();
    return expectedRequestId.isNotEmpty &&
        this.requestId == expectedRequestId &&
        this.gender == _normalizeGender(gender);
  }

  bool matchesQuery(String query) {
    final normalized = query.trim().toLowerCase();
    if (normalized.isEmpty) {
      return true;
    }
    return title.toLowerCase().contains(normalized) ||
        description.toLowerCase().contains(normalized) ||
        user.toLowerCase().contains(normalized) ||
        products.any(
          (product) =>
              product.name.toLowerCase().contains(normalized) ||
              product.brand.toLowerCase().contains(normalized) ||
              product.style.toLowerCase().contains(normalized),
        );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'user': user,
      'image': image,
      'title': title,
      'description': description,
      'products': products.map((product) => product.toJson()).toList(),
      'likes': likes,
      'request_id': requestId,
      'gender': gender,
      'style': style,
      'scene': scene,
      'image_source': imageSource,
      'authorId': authorId,
      'comments': comments,
      'saves': saves,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  static String _normalizeGender(String? value) {
    return switch (value?.trim().toLowerCase()) {
      'male' || '男' || '男性' || '男士' => 'male',
      'female' || '女' || '女性' || '女士' => 'female',
      _ => 'unisex',
    };
  }
}
