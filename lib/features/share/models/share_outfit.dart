import '../../../models/outfit_plan.dart';

class ShareOutfit {
  const ShareOutfit({
    required this.id,
    required this.userName,
    required this.outfitPlan,
    required this.generatedAt,
    this.tryOnImage,
    this.avatarBase64,
  });

  final String id;
  final String userName;
  final OutfitPlan outfitPlan;
  final DateTime generatedAt;
  final String? tryOnImage;
  final String? avatarBase64;

  String get fileName => 'Shupi_Look_${generatedAt.millisecondsSinceEpoch}';

  String get caption {
    final products = outfitPlan.products
        .map((product) => '${product.brand} ${product.name}')
        .join(' / ');
    return '${outfitPlan.title}\n$products\n${outfitPlan.reason}\n#树皮穿搭 #AI穿搭';
  }
}
