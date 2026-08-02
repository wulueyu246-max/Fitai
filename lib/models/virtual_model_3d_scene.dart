import 'product.dart';
import 'virtual_body_parameters.dart';

enum VirtualModelViewAngle { front, back }

class VirtualModel3DScene {
  const VirtualModel3DScene({
    required this.modelId,
    required this.bodyParameters,
    required this.products,
    required this.viewAngle,
    this.renderer = 'mock-canvas',
  });

  final String modelId;
  final VirtualBodyParameters bodyParameters;
  final List<Product> products;
  final VirtualModelViewAngle viewAngle;
  final String renderer;

  VirtualModel3DScene copyWith({
    VirtualBodyParameters? bodyParameters,
    List<Product>? products,
    VirtualModelViewAngle? viewAngle,
    String? renderer,
  }) {
    return VirtualModel3DScene(
      modelId: modelId,
      bodyParameters: bodyParameters ?? this.bodyParameters,
      products: products ?? this.products,
      viewAngle: viewAngle ?? this.viewAngle,
      renderer: renderer ?? this.renderer,
    );
  }
}
