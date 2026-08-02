import 'package:fit_ai/models/outfit_analysis.dart';
import 'package:fit_ai/models/outfit_request.dart';
import 'package:fit_ai/services/body_profile_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('builds structured body metrics from the existing AI response', () {
    const request = OutfitRequest(
      height: 173,
      weight: 55,
      scene: '通勤',
      request: '',
      images: {},
    );
    const analysis = OutfitAnalysis(
      bodyAnalysis: '整体偏瘦，肩部线条偏窄，腿长比例优秀',
      style: '极简通勤',
      top: '短款外套',
      bottom: '直筒裤',
      shoes: '轻量鞋',
      accessories: '腕表',
      suggestion: '保持利落线条',
    );

    final profile = const BodyProfileService().build(
      request: request,
      analysis: analysis,
    );

    expect(profile.height, 173);
    expect(profile.weight, 55);
    expect(profile.bodyType, '偏瘦身型');
    expect(profile.shoulderRatio, '肩宽偏窄');
    expect(profile.legRatio, '腿型修长');
  });
}
