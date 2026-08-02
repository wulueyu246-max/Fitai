class TryOnResult {
  const TryOnResult({
    required this.id,
    required this.image,
    required this.createdTime,
    required this.isMock,
  });

  final String id;

  /// Mock 阶段为本地 asset；真实服务可返回 HTTPS 图片地址。
  final String image;
  final DateTime createdTime;
  final bool isMock;

  bool get isNetworkImage {
    final uri = Uri.tryParse(image);
    return uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
  }
}
