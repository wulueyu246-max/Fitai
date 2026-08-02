import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/digital_wardrobe_item.dart';
import '../models/digital_wardrobe_look.dart';
import 'wardrobe_recognition_service.dart';

class DigitalWardrobeService {
  DigitalWardrobeService({
    WardrobeRecognitionService? recognitionService,
    SharedPreferencesAsync? storage,
  })  : _recognitionService =
            recognitionService ?? const MockWardrobeRecognitionService(),
        _storage = storage;

  static const _key = 'fitai.digital_wardrobe.items.v1';
  final WardrobeRecognitionService _recognitionService;
  SharedPreferencesAsync? _storage;
  final List<DigitalWardrobeItem> _memory = [];
  bool _loaded = false;

  Future<List<DigitalWardrobeItem>> load() async {
    if (_loaded) {
      return List.unmodifiable(_memory);
    }
    _loaded = true;
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      final values = await storage.getStringList(_key) ?? const [];
      _memory
        ..clear()
        ..addAll(
          values.map(
            (value) => DigitalWardrobeItem.fromJson(
              jsonDecode(value) as Map<String, dynamic>,
            ),
          ),
        );
    } catch (_) {
      _memory.clear();
    }
    return List.unmodifiable(_memory);
  }

  Future<DigitalWardrobeItem> addUploadedClothing({
    required List<int> imageBytes,
    required String fileName,
  }) async {
    await load();
    final recognition = await _recognitionService.recognize(
      imageBytes: imageBytes,
      fileName: fileName,
    );
    final now = DateTime.now();
    final item = DigitalWardrobeItem(
      id: 'wardrobe-${now.microsecondsSinceEpoch}',
      name: recognition.name,
      imageBase64: base64Encode(imageBytes),
      category: recognition.category,
      color: recognition.color,
      style: recognition.style,
      material: recognition.material,
      status: WardrobeRecognitionStatus.recognized,
      createdAt: now,
    );
    _memory.insert(0, item);
    await _save();
    return item;
  }

  Future<void> remove(String id) async {
    await load();
    _memory.removeWhere((item) => item.id == id);
    await _save();
  }

  Future<int> clearAll() async {
    await load();
    final removed = _memory.length;
    _memory.clear();
    await _save();
    return removed;
  }

  Future<DigitalWardrobeLook?> autoMatch() async {
    final items = await load();
    if (items.isEmpty) {
      return null;
    }
    final selected = <DigitalWardrobeItem>[];
    for (final category in const ['外套', '上衣', '裤子', '鞋']) {
      for (final item in items) {
        if (item.category == category && !selected.contains(item)) {
          selected.add(item);
          break;
        }
      }
    }
    if (selected.isEmpty) {
      selected.addAll(items.take(3));
    }
    final now = DateTime.now();
    return DigitalWardrobeLook(
      id: 'wardrobe-look-${now.microsecondsSinceEpoch}',
      title: '我的衣橱 AI 自动搭配',
      items: List.unmodifiable(selected),
      aiReason: '优先组合现有衣物的层次、颜色和场景属性；当前为 Mock '
          '规则，未来可替换为视觉识别与生成式搭配模型。',
      createdAt: now,
    );
  }

  Future<void> _save() async {
    try {
      final storage = _storage ??= SharedPreferencesAsync();
      await storage.setStringList(
        _key,
        _memory.map((item) => jsonEncode(item.toJson())).toList(),
      );
    } catch (_) {
      // The in-memory wardrobe remains usable without local persistence.
    }
  }
}
