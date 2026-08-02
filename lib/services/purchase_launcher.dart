import 'package:url_launcher/url_launcher.dart';

import '../models/product.dart';

abstract interface class PurchaseLauncher {
  Future<void> open(Product product);
}

class ExternalPurchaseLauncher implements PurchaseLauncher {
  const ExternalPurchaseLauncher();

  @override
  Future<void> open(Product product) async {
    final uri = Uri.tryParse(product.purchaseUrl);
    if (uri == null ||
        (uri.scheme != 'https' && uri.scheme != 'http') ||
        uri.host.isEmpty) {
      throw const PurchaseLaunchException('商品购买链接无效');
    }

    final launched = await launchUrl(
      uri,
      mode: LaunchMode.platformDefault,
      webOnlyWindowName: '_blank',
    );
    if (!launched) {
      throw const PurchaseLaunchException('无法打开品牌购买页面');
    }
  }
}

class PurchaseLaunchException implements Exception {
  const PurchaseLaunchException(this.message);

  final String message;

  @override
  String toString() => message;
}
