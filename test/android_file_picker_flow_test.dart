import 'dart:convert';
import 'dart:typed_data';

import 'package:fit_ai/models/app_location.dart';
import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:fit_ai/models/outfit_request.dart';
import 'package:fit_ai/pages/ai_outfit_page.dart';
import 'package:fit_ai/repositories/outfit_repository.dart';
import 'package:fit_ai/services/body_photo_picker.dart';
import 'package:fit_ai/services/consent_service.dart';
import 'package:fit_ai/services/location_service.dart';
import 'package:fit_ai/services/product_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';

void main() {
  testWidgets('upload entry uses the system gallery multi-image picker', (
    tester,
  ) async {
    final harness = await _pumpPage(tester, [_photo(1)]);

    await _openGallery(tester);

    expect(harness.picker.galleryCalls, 1);
    expect(harness.picker.requestedLimit, 3);
    expect(find.byKey(const Key('remove-photo-front')), findsOneWidget);
    expect(find.text('从文件选择'), findsNothing);
    expect(find.text('拍照上传'), findsNothing);
  });

  testWidgets('one selected photo defaults to front and can be submitted', (
    tester,
  ) async {
    final harness = await _pumpPage(tester, [_photo(1)]);
    await _openGallery(tester);

    await _submit(tester);

    expect(harness.repository.requests, hasLength(1));
    expect(harness.repository.requests.single.images.keys, ['front']);
  });

  testWidgets('two selected photos require unique role confirmation', (
    tester,
  ) async {
    final harness = await _pumpPage(tester, [_photo(1), _photo(2)]);
    await _openGallery(tester);

    await _assignRole(tester, 0, '正面照');
    await _assignRole(tester, 1, '侧面照');
    await _confirmRoles(tester);
    await _submit(tester);

    expect(harness.repository.requests, hasLength(1));
    expect(
      harness.repository.requests.single.images.keys.toSet(),
      {'front', 'side'},
    );
  });

  testWidgets('three photos can be assigned to front side and back', (
    tester,
  ) async {
    final harness = await _pumpPage(
      tester,
      [_photo(1), _photo(2), _photo(3)],
    );
    await _openGallery(tester);

    await _assignRole(tester, 0, '正面照');
    await _assignRole(tester, 1, '侧面照');
    await _assignRole(tester, 2, '背面照');
    await _confirmRoles(tester);
    await _submit(tester);

    expect(harness.repository.requests, hasLength(1));
    expect(
      harness.repository.requests.single.images.keys.toSet(),
      {'front', 'side', 'back'},
    );
  });

  testWidgets('more than three picker results are explicitly limited', (
    tester,
  ) async {
    await _pumpPage(tester, [_photo(1), _photo(2), _photo(3), _photo(4)]);

    await _openGallery(tester);

    expect(find.text('最多选择3张照片，已保留前3张'), findsOneWidget);
    expect(find.byKey(const Key('photo-role-2')), findsOneWidget);
    expect(find.byKey(const Key('photo-role-3')), findsNothing);
  });

  testWidgets('submission is blocked while the front photo is missing', (
    tester,
  ) async {
    final harness = await _pumpPage(tester, const []);

    await _submit(tester);

    expect(harness.repository.requests, isEmpty);
    expect(find.text('请填写有效的身高体重，并上传正面全身照'), findsOneWidget);
  });

  testWidgets('deleting the assigned front photo blocks submission again', (
    tester,
  ) async {
    final harness = await _pumpPage(tester, [_photo(1)]);
    await _openGallery(tester);

    final remove = find.byKey(const Key('remove-photo-front'));
    await tester.ensureVisible(remove);
    await tester.tap(remove);
    await tester.pumpAndSettle();
    await _submit(tester);

    expect(harness.repository.requests, isEmpty);
    expect(find.byKey(const Key('remove-photo-front')), findsNothing);
    expect(find.text('正面照：必填'), findsOneWidget);
  });
}

Future<_TestHarness> _pumpPage(
  WidgetTester tester,
  List<XFile> selectedImages,
) async {
  final picker = _FakeBodyPhotoPicker(selectedImages);
  final repository = _RecordingOutfitRepository();
  final consent = ConsentService();
  await consent.grantRequiredConsent();
  await tester.pumpWidget(
    MaterialApp(
      home: AiOutfitPage(
        bodyPhotoPicker: picker,
        repository: repository,
        productService: const MockProductService(delay: Duration.zero),
        consentService: consent,
        locationService: const _NoopLocationService(),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return _TestHarness(picker: picker, repository: repository);
}

Future<void> _openGallery(WidgetTester tester) async {
  final picker = find.byKey(const Key('photo-gallery-picker'));
  await tester.ensureVisible(picker);
  await tester.tap(picker);
  await tester.pumpAndSettle();
}

Future<void> _assignRole(
  WidgetTester tester,
  int index,
  String roleLabel,
) async {
  final dropdown = find.byKey(Key('photo-role-$index'));
  await tester.ensureVisible(dropdown);
  await tester.tap(dropdown);
  await tester.pumpAndSettle();
  await tester.tap(find.text(roleLabel).last);
  await tester.pumpAndSettle();
}

Future<void> _confirmRoles(WidgetTester tester) async {
  final confirm = find.byKey(const Key('confirm-photo-roles'));
  await tester.ensureVisible(confirm);
  await tester.tap(confirm);
  await tester.pumpAndSettle();
}

Future<void> _submit(WidgetTester tester) async {
  await tester.enterText(find.byKey(const Key('ai-height')), '170');
  await tester.enterText(find.byKey(const Key('ai-weight')), '60');
  final generate = find.byKey(const Key('generate-outfit'));
  await tester.ensureVisible(generate);
  await tester.tap(generate);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

XFile _photo(int index) {
  const onePixelPng =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  return XFile.fromData(
    Uint8List.fromList(base64Decode(onePixelPng)),
    path: 'body-$index.png',
    name: 'body-$index.png',
    mimeType: 'image/png',
  );
}

class _TestHarness {
  const _TestHarness({required this.picker, required this.repository});

  final _FakeBodyPhotoPicker picker;
  final _RecordingOutfitRepository repository;
}

class _FakeBodyPhotoPicker implements BodyPhotoPicker {
  _FakeBodyPhotoPicker(this.images);

  final List<XFile> images;
  int galleryCalls = 0;
  int? requestedLimit;

  @override
  Future<List<XFile>> pickFromGallery({int limit = 3}) async {
    galleryCalls += 1;
    requestedLimit = limit;
    return images;
  }

  @override
  Future<List<XFile>> retrieveLostGalleryImages() async => const [];
}

class _RecordingOutfitRepository implements OutfitRepository {
  final List<OutfitRequest> requests = [];

  @override
  Future<OutfitAnalysis> generateOutfit(OutfitRequest request) async {
    requests.add(request);
    return const OutfitAnalysis(
      bodyAnalysis: '身体比例均衡',
      style: '简约通勤',
      top: '短款上衣',
      bottom: '直筒裤',
      shoes: '低帮鞋',
      accessories: '简约配饰',
      suggestion: '保持利落轮廓',
    );
  }

  @override
  void close() {}
}

class _NoopLocationService implements LocationService {
  const _NoopLocationService();

  @override
  Future<AppLocation?> load() async => null;

  @override
  Future<AppLocation> resolveCity(String city) => throw UnimplementedError();

  @override
  Future<void> save(AppLocation location) async {}

  @override
  Future<AppLocation> useDeviceLocation() => throw UnimplementedError();
}
