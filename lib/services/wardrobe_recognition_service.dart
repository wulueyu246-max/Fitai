class WardrobeRecognition {
  const WardrobeRecognition({
    required this.name,
    required this.category,
    required this.color,
    required this.style,
    required this.material,
  });

  final String name;
  final String category;
  final String color;
  final String style;
  final String material;
}

abstract interface class WardrobeRecognitionService {
  Future<WardrobeRecognition> recognize({
    required List<int> imageBytes,
    required String fileName,
  });
}

class MockWardrobeRecognitionService implements WardrobeRecognitionService {
  const MockWardrobeRecognitionService({
    this.delay = const Duration(milliseconds: 700),
  });

  final Duration delay;

  @override
  Future<WardrobeRecognition> recognize({
    required List<int> imageBytes,
    required String fileName,
  }) async {
    if (imageBytes.isEmpty) {
      throw ArgumentError('The clothing image is empty');
    }
    if (delay > Duration.zero) {
      await Future<void>.delayed(delay);
    }
    final sample = (imageBytes.length + fileName.length) % 4;
    return [
      const WardrobeRecognition(
        name: '简约纯棉上衣',
        category: '上衣',
        color: '白色',
        style: '极简',
        material: '棉',
      ),
      const WardrobeRecognition(
        name: '直筒日常长裤',
        category: '裤子',
        color: '黑色',
        style: '通勤',
        material: '棉混纺',
      ),
      const WardrobeRecognition(
        name: '结构感短外套',
        category: '外套',
        color: '深灰色',
        style: '高级感',
        material: '羊毛混纺',
      ),
      const WardrobeRecognition(
        name: '轻量休闲鞋',
        category: '鞋',
        color: '米白色',
        style: '休闲',
        material: '织物',
      ),
    ][sample];
  }
}
