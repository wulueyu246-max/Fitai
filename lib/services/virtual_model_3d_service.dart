import '../models/product.dart';
import '../models/virtual_body_parameters.dart';
import '../models/virtual_model.dart';
import '../models/virtual_model_3d_scene.dart';

abstract interface class VirtualModel3DService {
  Future<VirtualModel3DScene> createScene({
    required VirtualModel model,
    required VirtualBodyParameters bodyParameters,
  });

  Future<VirtualModel3DScene> updateBody(
    VirtualModel3DScene scene,
    VirtualBodyParameters bodyParameters,
  );

  Future<VirtualModel3DScene> updateGarments(
    VirtualModel3DScene scene,
    List<Product> products,
  );

  Future<VirtualModel3DScene> setViewAngle(
    VirtualModel3DScene scene,
    VirtualModelViewAngle viewAngle,
  );
}

class MockVirtualModel3DService implements VirtualModel3DService {
  const MockVirtualModel3DService();

  @override
  Future<VirtualModel3DScene> createScene({
    required VirtualModel model,
    required VirtualBodyParameters bodyParameters,
  }) async {
    return VirtualModel3DScene(
      modelId: model.id,
      bodyParameters: bodyParameters,
      products: List.unmodifiable(model.outfit.products),
      viewAngle: VirtualModelViewAngle.front,
    );
  }

  @override
  Future<VirtualModel3DScene> updateBody(
    VirtualModel3DScene scene,
    VirtualBodyParameters bodyParameters,
  ) async {
    return scene.copyWith(bodyParameters: bodyParameters);
  }

  @override
  Future<VirtualModel3DScene> updateGarments(
    VirtualModel3DScene scene,
    List<Product> products,
  ) async {
    return scene.copyWith(products: List.unmodifiable(products));
  }

  @override
  Future<VirtualModel3DScene> setViewAngle(
    VirtualModel3DScene scene,
    VirtualModelViewAngle viewAngle,
  ) async {
    return scene.copyWith(viewAngle: viewAngle);
  }
}
