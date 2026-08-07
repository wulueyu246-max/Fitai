import 'package:fit_ai/models/first_launch_profile.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('first launch profile round-trips validation inputs', () {
    const profile = FirstLaunchProfile(
      gender: '女',
      height: 165,
      weight: 50,
      ageRange: '25-34',
      occupation: '城市职场',
      scene: '工作',
    );

    final restored = FirstLaunchProfile.fromJson(profile.toJson());
    expect(restored.gender, '女');
    expect(restored.height, 165);
    expect(restored.weight, 50);
    expect(restored.scene, '工作');
    expect(restored.representativeAge, 29);
  });
}
