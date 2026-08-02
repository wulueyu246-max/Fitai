import 'product.dart';

class Outfit {
  const Outfit({
    required this.height,
    required this.weight,
    required this.bodyType,
    required this.style,
    required this.userImages,
    required this.products,
    this.userId = 'local-demo-user',
  });

  final double height;
  final double weight;
  final String bodyType;
  final String style;
  final Map<String, String> userImages;
  final List<Product> products;
  final String userId;

  Product? productForCategory(String category) {
    for (final product in products) {
      if (product.wardrobeSlot == category) {
        return product;
      }
    }

    return null;
  }

  Outfit replaceProduct(Product product) {
    final updatedProducts = List<Product>.from(products);
    final existingIndex = updatedProducts.indexWhere(
      (item) => item.wardrobeSlot == product.wardrobeSlot,
    );

    if (existingIndex == -1) {
      updatedProducts.add(product);
    } else {
      updatedProducts[existingIndex] = product;
    }

    return copyWith(products: updatedProducts);
  }

  Outfit copyWith({
    double? height,
    double? weight,
    String? bodyType,
    String? style,
    Map<String, String>? userImages,
    List<Product>? products,
    String? userId,
  }) {
    return Outfit(
      height: height ?? this.height,
      weight: weight ?? this.weight,
      bodyType: bodyType ?? this.bodyType,
      style: style ?? this.style,
      userImages: userImages ?? this.userImages,
      products: products ?? this.products,
      userId: userId ?? this.userId,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'height': height,
      'weight': weight,
      'body_type': bodyType,
      'style': style,
      'user_images': userImages,
      'products': products.map((product) => product.toJson()).toList(),
      'user_id': userId,
    };
  }
}
