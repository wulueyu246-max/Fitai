import 'package:flutter/material.dart';

import '../models/first_launch_profile.dart';

class OnboardingPage extends StatefulWidget {
  const OnboardingPage({
    required this.onComplete,
    super.key,
  });

  final Future<void> Function(FirstLaunchProfile profile) onComplete;

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> {
  final PageController _controller = PageController();
  final TextEditingController _height = TextEditingController(text: '173');
  final TextEditingController _weight = TextEditingController(text: '60');
  int _index = 0;
  String _gender = '未设置';
  String _ageRange = '25-34';
  String _occupation = '城市职场';
  String _scene = '日常';
  RangeValues _budget = const RangeValues(200, 1200);
  bool _submitting = false;

  static const _scenes = ['日常', '工作', '约会', '聚会', '旅行'];
  static const _pages = [
    _OnboardingContent(
      icon: Icons.auto_awesome_rounded,
      eyebrow: '欢迎来到树皮 Shupi',
      title: '你的 AI 个人穿搭顾问',
      description: '树皮会结合你的身体比例、风格偏好与真实生活场景，生成可以直接执行的穿搭方案。',
      accent: Color(0xFF244C3A),
    ),
    _OnboardingContent(
      icon: Icons.straighten_rounded,
      eyebrow: '不再靠猜',
      title: '理解比例，再推荐衣服',
      description: '从版型、颜色到搭配位置，告诉你为什么适合，而不只是给出一串商品。',
      accent: Color(0xFF456C65),
    ),
    _OnboardingContent(
      icon: Icons.add_a_photo_outlined,
      eyebrow: '上传照片的收益',
      title: '得到真正属于你的方案',
      description: '一张正面全身照即可开始；侧面和背面照片能帮助 AI 更完整地分析比例。照片可在隐私中心删除。',
      accent: Color(0xFF82613D),
    ),
  ];

  @override
  void dispose() {
    _controller.dispose();
    _height.dispose();
    _weight.dispose();
    super.dispose();
  }

  Future<void> _next() async {
    if (_index < _pages.length) {
      await _controller.nextPage(
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
      return;
    }
    final height = double.tryParse(_height.text.trim());
    final weight = double.tryParse(_weight.text.trim());
    if (_gender == '未设置' ||
        height == null ||
        height < 120 ||
        height > 230 ||
        weight == null ||
        weight < 30 ||
        weight > 250) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请选择身份，并填写有效的身高和体重')),
      );
      return;
    }
    final profile = FirstLaunchProfile(
      gender: _gender,
      height: height,
      weight: weight,
      ageRange: _ageRange,
      occupation: _occupation,
      scene: _scene,
      budgetMin: _budget.start,
      budgetMax: _budget.end,
    );
    setState(() => _submitting = true);
    try {
      await widget.onComplete(profile);
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isTaskPage = _index == _pages.length;
    return Scaffold(
      key: const Key('fitai-onboarding'),
      backgroundColor: const Color(0xFFF7F3EA),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 18, 24, 0),
              child: Row(
                children: [
                  const Text(
                    '树皮 Shupi',
                    style: TextStyle(
                      fontSize: 23,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '${_index + 1}/${_pages.length + 1}',
                    style: const TextStyle(color: Color(0xFF817A74)),
                  ),
                ],
              ),
            ),
            Expanded(
              child: PageView(
                controller: _controller,
                physics: const NeverScrollableScrollPhysics(),
                onPageChanged: (value) => setState(() => _index = value),
                children: [
                  for (final page in _pages) _IntroPage(content: page),
                  _FirstTaskPage(
                    scenes: _scenes,
                    selectedScene: _scene,
                    gender: _gender,
                    ageRange: _ageRange,
                    occupation: _occupation,
                    budget: _budget,
                    heightController: _height,
                    weightController: _weight,
                    onSceneSelected: (value) => setState(() => _scene = value),
                    onGenderSelected: (value) =>
                        setState(() => _gender = value),
                    onAgeRangeSelected: (value) =>
                        setState(() => _ageRange = value),
                    onOccupationSelected: (value) =>
                        setState(() => _occupation = value),
                    onBudgetChanged: (value) => setState(() => _budget = value),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 10, 24, 24),
              child: Column(
                children: [
                  Row(
                    children: [
                      for (var index = 0; index < _pages.length + 1; index++)
                        Expanded(
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 220),
                            height: 4,
                            margin: EdgeInsets.only(
                              right: index == _pages.length ? 0 : 6,
                            ),
                            decoration: BoxDecoration(
                              color: index <= _index
                                  ? const Color(0xFF244C3A)
                                  : const Color(0xFFE1DDD7),
                              borderRadius: BorderRadius.circular(999),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      key: Key(
                        isTaskPage ? 'complete-onboarding' : 'next-onboarding',
                      ),
                      onPressed: _submitting ? null : _next,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF244C3A),
                        padding: const EdgeInsets.symmetric(vertical: 17),
                      ),
                      child: Text(
                        _submitting
                            ? '正在准备...'
                            : isTaskPage
                                ? '开始生成第一套方案'
                                : '继续',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnboardingContent {
  const _OnboardingContent({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.description,
    required this.accent,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final String description;
  final Color accent;
}

class _IntroPage extends StatelessWidget {
  const _IntroPage({required this.content});

  final _OnboardingContent content;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Column(
            children: [
              Container(
                width: 150,
                height: 190,
                decoration: BoxDecoration(
                  color: content.accent,
                  borderRadius: BorderRadius.circular(38),
                  boxShadow: [
                    BoxShadow(
                      color: content.accent.withValues(alpha: 0.24),
                      blurRadius: 34,
                      offset: const Offset(0, 18),
                    ),
                  ],
                ),
                child: Icon(content.icon, color: Colors.white, size: 64),
              ),
              const SizedBox(height: 40),
              Text(
                content.eyebrow,
                style: TextStyle(
                  color: content.accent,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                content.title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 31,
                  height: 1.18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                content.description,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF746E68),
                  fontSize: 15,
                  height: 1.65,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FirstTaskPage extends StatelessWidget {
  const _FirstTaskPage({
    required this.scenes,
    required this.selectedScene,
    required this.gender,
    required this.ageRange,
    required this.occupation,
    required this.budget,
    required this.heightController,
    required this.weightController,
    required this.onSceneSelected,
    required this.onGenderSelected,
    required this.onAgeRangeSelected,
    required this.onOccupationSelected,
    required this.onBudgetChanged,
  });

  final List<String> scenes;
  final String selectedScene;
  final String gender;
  final String ageRange;
  final String occupation;
  final RangeValues budget;
  final TextEditingController heightController;
  final TextEditingController weightController;
  final ValueChanged<String> onSceneSelected;
  final ValueChanged<String> onGenderSelected;
  final ValueChanged<String> onAgeRangeSelected;
  final ValueChanged<String> onOccupationSelected;
  final ValueChanged<RangeValues> onBudgetChanged;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Column(
            children: [
              const Icon(Icons.checkroom_rounded, size: 44),
              const SizedBox(height: 14),
              const Text(
                '先认识你，再生成第一套穿搭',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 29,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                '这些信息只用于改善推荐，可稍后在个人资料中修改。',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF746E68),
                  height: 1.55,
                ),
              ),
              const SizedBox(height: 20),
              const _FieldLabel('身份'),
              Wrap(
                spacing: 9,
                children: [
                  for (final value in const ['女', '男'])
                    ChoiceChip(
                      key: Key('onboarding-gender-$value'),
                      label: Text(value),
                      selected: gender == value,
                      onSelected: (_) => onGenderSelected(value),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('onboarding-height'),
                      controller: heightController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: '身高',
                        suffixText: 'cm',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      key: const Key('onboarding-weight'),
                      controller: weightController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: '体重',
                        suffixText: 'kg',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const _FieldLabel('年龄段'),
              Wrap(
                spacing: 7,
                runSpacing: 7,
                children: [
                  for (final value in const [
                    '18-24',
                    '25-34',
                    '35-44',
                    '45-54',
                    '55-64'
                  ])
                    ChoiceChip(
                      key: Key('onboarding-age-$value'),
                      label: Text(value),
                      selected: ageRange == value,
                      onSelected: (_) => onAgeRangeSelected(value),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                key: const Key('onboarding-occupation'),
                initialValue: occupation,
                decoration: const InputDecoration(
                  labelText: '职业',
                  border: OutlineInputBorder(),
                ),
                items: const ['学生', '城市职场', '创意行业', '自由职业', '其他']
                    .map((value) => DropdownMenuItem(
                          value: value,
                          child: Text(value),
                        ))
                    .toList(),
                onChanged: (value) {
                  if (value != null) onOccupationSelected(value);
                },
              ),
              const SizedBox(height: 16),
              const _FieldLabel('第一套穿搭场景'),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final scene in scenes)
                    ChoiceChip(
                      key: Key('onboarding-scene-$scene'),
                      label: Text(scene),
                      selected: selectedScene == scene,
                      onSelected: (_) => onSceneSelected(scene),
                      selectedColor: const Color(0xFF244C3A),
                      labelStyle: TextStyle(
                        color: selectedScene == scene
                            ? Colors.white
                            : const Color(0xFF3E3935),
                        fontWeight: FontWeight.w800,
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 15,
                        vertical: 11,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              _FieldLabel(
                '预算 ¥${budget.start.toStringAsFixed(0)} - '
                '¥${budget.end.toStringAsFixed(0)}',
              ),
              RangeSlider(
                key: const Key('onboarding-budget'),
                values: budget,
                min: 0,
                max: 3000,
                divisions: 30,
                onChanged: onBudgetChanged,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          text,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
    );
  }
}
