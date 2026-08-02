import '../models/app_location.dart';
import '../models/product.dart';
import '../models/weather_snapshot.dart';

/// 将实时天气转换成可执行的 AI 提示词和商品排序规则。
///
/// 该层保持纯本地、可测试；未来更换推荐模型时，页面无需理解天气代码。
class WeatherOutfitAdvisor {
  const WeatherOutfitAdvisor();

  String buildPrompt({
    required WeatherSnapshot weather,
    required String scene,
    AppLocation? location,
  }) {
    final region = [
      location?.country ?? weather.country,
      location?.city ?? weather.city,
    ].where((value) => value.trim().isNotEmpty).join(' ');
    final rules = _rules(weather);
    return '用户地区：${region.isEmpty ? weather.city : region}；'
        '当前实时天气：${weather.aiContext}；场景：$scene。'
        '穿搭方案必须遵循：${rules.join('；')}。';
  }

  List<Product> adaptProducts({
    required List<Product> products,
    required WeatherSnapshot weather,
    required String scene,
  }) {
    final ranked = products.indexed.toList()
      ..sort((left, right) {
        final rightScore = _score(right.$2, weather);
        final leftScore = _score(left.$2, weather);
        final comparison = rightScore.compareTo(leftScore);
        return comparison != 0 ? comparison : left.$1.compareTo(right.$1);
      });
    return List<Product>.unmodifiable(
      ranked.map((item) {
        final product = item.$2;
        final weatherReason = _productReason(product, weather);
        return product.copyWith(
          aiReason: '${product.aiReason}；$weatherReason，适合$scene场景。',
        );
      }),
    );
  }

  List<String> _rules(WeatherSnapshot weather) {
    final rules = <String>[];
    if (weather.isRainy) {
      rules.add('有雨时优先防泼水外套、包裹性鞋履和不易吸水材质');
    }
    if (weather.isSnowy) {
      rules.add('有雪时优先保暖、防滑鞋履和分层穿搭');
    }
    if (weather.temperature >= 28) {
      rules.add('高温时优先短袖、透气或速干材质，减少厚重层次');
    } else if (weather.temperature <= 12) {
      rules.add('低温时增加保暖外套和可叠穿中层');
    }
    if (weather.humidity >= 75) {
      rules.add('高湿度时避免闷热面料，优先透气和速干单品');
    }
    if (weather.windSpeed >= 20) {
      rules.add('风力较强时增加防风外层并避免过于宽松的下摆');
    }
    if (rules.isEmpty) {
      rules.add('根据当前温度选择轻重适中的层次和舒适面料');
    }
    return rules;
  }

  int _score(Product product, WeatherSnapshot weather) {
    final text = '${product.name} ${product.material} ${product.description} '
            '${product.style} ${product.season}'
        .toLowerCase();
    var score = 0;
    if (weather.isRainy) {
      if (product.category == ProductCategory.outerwear) score += 18;
      if (product.category == ProductCategory.shoes) score += 14;
      if (_containsAny(text, const ['防水', '防风', '机能', '橡胶', '皮革'])) {
        score += 16;
      }
    }
    if (weather.isSnowy || weather.temperature <= 12) {
      if (product.category == ProductCategory.outerwear) score += 20;
      if (_containsAny(text, const ['羊毛', '羽绒', '保暖', '厚'])) score += 14;
    }
    if (weather.temperature >= 28 || weather.humidity >= 75) {
      if (product.category == ProductCategory.tee) score += 20;
      if (_containsAny(text, const ['透气', '速干', 'airism', 'dri-fit', '棉'])) {
        score += 14;
      }
      if (_containsAny(text, const ['羊毛', '羽绒', '厚'])) score -= 18;
    }
    if (weather.windSpeed >= 20 &&
        product.category == ProductCategory.outerwear) {
      score += 14;
    }
    return score;
  }

  String _productReason(Product product, WeatherSnapshot weather) {
    if (weather.isRainy && product.category == ProductCategory.shoes) {
      return '当前有雨，优先推荐包裹性更好、不易吸水的鞋履';
    }
    if (weather.isRainy && product.category == ProductCategory.outerwear) {
      return '当前有雨，外层可降低风雨对体感温度的影响';
    }
    if ((weather.temperature >= 28 || weather.humidity >= 75) &&
        product.wardrobeSlot == ProductCategory.top) {
      return '当前高温或湿度较高，优先选择轻薄、透气的上装';
    }
    if ((weather.isSnowy || weather.temperature <= 12) &&
        product.category == ProductCategory.outerwear) {
      return '当前温度较低，保暖外层可维持舒适体感';
    }
    if (weather.windSpeed >= 20) {
      return '当前风力较强，搭配需兼顾防风和活动便利性';
    }
    return '单品厚度与当前${weather.temperature.round()}℃体感相匹配';
  }

  bool _containsAny(String value, List<String> needles) {
    return needles.any(value.contains);
  }
}
