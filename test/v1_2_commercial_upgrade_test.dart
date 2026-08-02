import 'dart:convert';

import 'package:fit_ai/components/body_parameter_panel.dart';
import 'package:fit_ai/components/outfit_plan_card.dart';
import 'package:fit_ai/components/virtual_model_3d_view.dart';
import 'package:fit_ai/data/mock_product_database.dart';
import 'package:fit_ai/features/user/models/auth_session.dart';
import 'package:fit_ai/features/user/models/user_account.dart';
import 'package:fit_ai/features/user/repositories/auth_repository.dart';
import 'package:fit_ai/features/user/services/user_session_controller.dart';
import 'package:fit_ai/models/outfit.dart';
import 'package:fit_ai/models/outfit_plan.dart';
import 'package:fit_ai/models/product.dart';
import 'package:fit_ai/models/virtual_body_parameters.dart';
import 'package:fit_ai/models/virtual_model_3d_scene.dart';
import 'package:fit_ai/models/virtual_model.dart';
import 'package:fit_ai/services/virtual_model_3d_service.dart';
import 'package:fit_ai/services/virtual_try_on_service.dart';
import 'package:fit_ai/services/wardrobe_sync_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('remote wardrobe service pulls and pushes authenticated cloud data',
      () async {
    final controller = UserSessionController(repository: _MemoryAuth());
    expect(
      await controller.register(
        email: 'user@example.com',
        password: 'password-2026',
        displayName: '测试用户',
      ),
      isTrue,
    );
    Map<String, dynamic>? pushed;
    final product = MockProductDatabase.products.first;
    final client = MockClient((request) async {
      expect(request.headers['authorization'], startsWith('Bearer '));
      if (request.method == 'GET') {
        return http.Response(
          jsonEncode({
            'wardrobe': {
              'favoriteProducts': [product.toJson()],
              'outfitPlans': [],
              'tryOnHistory': [],
              'aiRecommendationHistory': [],
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      pushed = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(
        jsonEncode({'wardrobe': pushed}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final service = RemoteWardrobeSyncService(
      baseUrl: Uri.parse('https://api.fitai.test'),
      sessionController: controller,
      client: client,
    );

    final snapshot = await service.pull();
    expect(snapshot?.favoriteProducts.single.id, product.id);
    await service.push(snapshot!);
    expect(pushed?['favoriteProducts'], hasLength(1));
  });

  test('mock 3D service keeps replaceable body, garments and view contracts',
      () async {
    final model = await _model();
    const service = MockVirtualModel3DService();
    var scene = await service.createScene(
      model: model,
      bodyParameters: const VirtualBodyParameters(height: 173, weight: 60),
    );
    scene = await service.updateBody(
      scene,
      scene.bodyParameters.copyWith(shoulderScale: 1.1),
    );
    scene = await service.setViewAngle(scene, VirtualModelViewAngle.back);

    expect(scene.renderer, 'mock-canvas');
    expect(scene.bodyParameters.shoulderScale, 1.1);
    expect(scene.viewAngle, VirtualModelViewAngle.back);
    expect(scene.products, hasLength(3));
  });

  testWidgets('AI plan supports regenerate and explicit save actions',
      (tester) async {
    final plan = _plan();
    var regenerated = false;
    var saved = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: OutfitPlanCard(
              plan: plan,
              favorite: false,
              onFavorite: () => saved = true,
              onTryOn: () {},
              onProductTap: (_) {},
              onRegenerate: () => regenerated = true,
            ),
          ),
        ),
      ),
    );

    final regenerate = find.byKey(const Key('regenerate-outfit-plan'));
    await tester.ensureVisible(regenerate);
    await tester.tap(regenerate);
    final save = find.byKey(const Key('save-outfit-plan'));
    await tester.ensureVisible(save);
    await tester.tap(save);
    expect(regenerated, isTrue);
    expect(saved, isTrue);
    expect(find.text('匹配度 90%'), findsOneWidget);
    expect(find.text('进入 3D 虚拟试穿'), findsOneWidget);
  });

  testWidgets('3D viewport switches front/back and exposes body parameters',
      (tester) async {
    final model = await _model();
    var angle = VirtualModelViewAngle.front;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: StatefulBuilder(
              builder: (context, setState) => Column(
                children: [
                  VirtualModel3DView(
                    model: model,
                    bodyParameters: const VirtualBodyParameters(
                      height: 173,
                      weight: 60,
                    ),
                    viewAngle: angle,
                    isUpdating: false,
                    onViewAngleChanged: (value) =>
                        setState(() => angle = value),
                  ),
                  BodyParameterPanel(
                    parameters: const VirtualBodyParameters(
                      height: 173,
                      weight: 60,
                    ),
                    onChanged: (_) {},
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('model-view-back')));
    await tester.pumpAndSettle();
    expect(angle, VirtualModelViewAngle.back);
    expect(find.byKey(const Key('virtual-model-3d-viewport')), findsOneWidget);
    expect(find.byKey(const Key('body-parameter-panel')), findsOneWidget);
  });
}

OutfitPlan _plan() {
  Product slot(String category) => MockProductDatabase.products.firstWhere(
        (product) => product.wardrobeSlot == category,
      );
  return OutfitPlan(
    id: 'plan-v1-2',
    title: '你的专属通勤方案',
    top: slot(ProductCategory.top),
    bottom: slot(ProductCategory.bottom),
    shoes: slot(ProductCategory.shoes),
    reason: '根据身材、风格和场景生成。',
    createdTime: DateTime(2026, 7, 31),
    scene: '通勤',
    matchScore: 90,
  );
}

Future<VirtualModel> _model() {
  final plan = _plan();
  const service = MockVirtualTryOnService(delay: Duration.zero);
  return service.generateVirtualModel(
    Outfit(
      height: 173,
      weight: 60,
      bodyType: '匀称',
      style: '极简',
      userImages: const {},
      products: plan.products,
    ),
  );
}

class _MemoryAuth implements AuthRepository {
  UserAccount? account;
  AuthSession? session;

  @override
  Future<AuthResult> register({
    required String email,
    required String password,
    required String displayName,
  }) async {
    final now = DateTime.now();
    account = UserAccount(
      id: 'user-cloud-test',
      email: email,
      displayName: displayName,
      height: 173,
      weight: 60,
      bodyType: '匀称',
      likedStyles: const ['极简'],
      budgetMin: 100,
      budgetMax: 1200,
      favoriteBrands: const ['COS'],
      createdAt: now,
    );
    session = AuthSession(
      userId: account!.id,
      token: 'cloud-test-token-1234567890',
      createdAt: now,
      expiresAt: now.add(const Duration(days: 1)),
    );
    return AuthResult(account: account!, session: session!);
  }

  @override
  Future<AuthResult> login({required String email, required String password}) =>
      register(email: email, password: password, displayName: '测试用户');

  @override
  Future<void> logout() async => session = null;

  @override
  Future<AuthResult?> restoreSession() async => null;

  @override
  Future<UserAccount> updateProfile(UserAccount value) async {
    account = value;
    return value;
  }
}
