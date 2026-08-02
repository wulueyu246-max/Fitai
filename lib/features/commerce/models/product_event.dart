enum ProductEventType {
  impression,
  click,
  favorite,
  addToTryOn,
  purchaseRedirect,
  purchaseCompleted,
}

class ProductEvent {
  const ProductEvent({
    required this.id,
    required this.productId,
    required this.sku,
    required this.type,
    required this.source,
    required this.createdAt,
    this.userId = 'local-demo-user',
    this.orderId,
  });

  final String id;
  final String userId;
  final String productId;
  final String sku;
  final ProductEventType type;
  final String source;
  final DateTime createdAt;
  final String? orderId;
}
