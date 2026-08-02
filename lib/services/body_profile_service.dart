import '../models/body_profile.dart';
import '../models/outfit_analysis.dart';
import '../models/outfit_request.dart';

class BodyProfileService {
  const BodyProfileService();

  BodyProfile build({
    required OutfitRequest request,
    required OutfitAnalysis analysis,
  }) {
    final report = analysis.bodyAnalysis;
    return BodyProfile(
      height: request.height,
      weight: request.weight,
      bodyType: _bodyType(report, request),
      shoulderRatio: _shoulderRatio(report),
      legRatio: _legRatio(report),
    );
  }

  String _bodyType(String report, OutfitRequest request) {
    for (final value in const ['偏瘦', '匀称', '健壮', '微胖', '修长']) {
      if (report.contains(value)) {
        return '$value身型';
      }
    }
    final bmi =
        request.weight / ((request.height / 100) * (request.height / 100));
    if (bmi < 18.5) {
      return '偏瘦身型';
    }
    if (bmi >= 24) {
      return '稳健身型';
    }
    return '匀称身型';
  }

  String _shoulderRatio(String report) {
    if (report.contains('肩窄') ||
        report.contains('窄肩') ||
        report.contains('肩部线条偏窄')) {
      return '肩宽偏窄';
    }
    if (report.contains('肩宽') || report.contains('宽肩')) {
      return '肩宽偏宽';
    }
    return '肩宽均衡';
  }

  String _legRatio(String report) {
    if (report.contains('腿短') || report.contains('腿长比例偏短')) {
      return '腿长偏短';
    }
    if (report.contains('长腿') ||
        report.contains('腿长比例优秀') ||
        report.contains('修长')) {
      return '腿型修长';
    }
    return '腿型均衡';
  }
}
