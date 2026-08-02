import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../../services/user_profile_service.dart';
import '../models/user_account.dart';
import '../services/user_session_controller.dart';

class UserProfilePage extends StatefulWidget {
  const UserProfilePage({
    required this.controller,
    required this.account,
    super.key,
  });

  final UserSessionController controller;
  final UserAccount account;

  @override
  State<UserProfilePage> createState() => _UserProfilePageState();
}

class _UserProfilePageState extends State<UserProfilePage> {
  final UserProfileService _profileService = UserProfileService();
  late final TextEditingController _name;
  late final TextEditingController _height;
  late final TextEditingController _weight;
  late final TextEditingController _age;
  late String _gender;
  late String _bodyType;
  late Set<String> _styles;
  late Set<String> _brands;
  late RangeValues _budget;
  String? _avatarBase64;
  bool _saving = false;

  static const _styleOptions = ['商务休闲', '日系简约', '街头风', '运动风', '极简'];
  static const _brandOptions = ['UNIQLO', 'Nike', 'Adidas', 'ZARA', 'COS'];

  @override
  void initState() {
    super.initState();
    final account = widget.account;
    _name = TextEditingController(text: account.displayName);
    _height = TextEditingController(text: account.height.toStringAsFixed(0));
    _weight = TextEditingController(text: account.weight.toStringAsFixed(0));
    _age = TextEditingController(text: account.age.toString());
    _gender = account.gender;
    _bodyType = account.bodyType;
    _styles = {...account.likedStyles};
    _brands = {...account.favoriteBrands};
    _budget = RangeValues(
      account.budgetMin.clamp(0, 3000),
      account.budgetMax.clamp(0, 3000),
    );
    _avatarBase64 = account.avatarBase64;
  }

  @override
  void dispose() {
    _name.dispose();
    _height.dispose();
    _weight.dispose();
    _age.dispose();
    super.dispose();
  }

  Future<void> _pickAvatar() async {
    final image = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 75,
      maxWidth: 800,
    );
    if (image == null || !mounted) {
      return;
    }
    final bytes = await image.readAsBytes();
    if (mounted) {
      setState(() => _avatarBase64 = base64Encode(bytes));
    }
  }

  Future<void> _save() async {
    final height = double.tryParse(_height.text);
    final weight = double.tryParse(_weight.text);
    final age = int.tryParse(_age.text);
    if (height == null ||
        weight == null ||
        age == null ||
        height <= 0 ||
        weight <= 0 ||
        age < 13 ||
        age > 100) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入有效的身高、体重和年龄（13-100岁）')),
      );
      return;
    }
    setState(() => _saving = true);
    final success = await widget.controller.updateProfile(
      widget.account.copyWith(
        displayName: _name.text.trim(),
        avatarBase64: _avatarBase64,
        height: height,
        weight: weight,
        age: age,
        gender: _gender,
        bodyType: _bodyType,
        likedStyles: _styles.toList(growable: false),
        budgetMin: _budget.start,
        budgetMax: _budget.end,
        favoriteBrands: _brands.toList(growable: false),
      ),
    );
    if (!mounted) {
      return;
    }
    setState(() => _saving = false);
    if (success) {
      final profile = await _profileService.load();
      await _profileService.save(
        profile.copyWith(
          avatarBase64: _avatarBase64,
          height: height,
          weight: weight,
          age: age,
          gender: _gender,
          bodyType: _bodyType,
          stylePreference: _styles.toList(growable: false),
          favoriteBrands: _brands.toList(growable: false),
        ),
      );
      if (!mounted) {
        return;
      }
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F6F3),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF7F6F3),
        title: const Text('个人资料'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          Center(
            child: Stack(
              children: [
                CircleAvatar(
                  radius: 50,
                  backgroundColor: const Color(0xFFE9E1ED),
                  backgroundImage: _avatarBase64 == null
                      ? null
                      : MemoryImage(base64Decode(_avatarBase64!)),
                  child: _avatarBase64 == null
                      ? const Icon(Icons.person_rounded, size: 48)
                      : null,
                ),
                Positioned(
                  right: 0,
                  bottom: 0,
                  child: IconButton.filled(
                    key: const Key('pick-user-avatar'),
                    onPressed: _pickAvatar,
                    icon: const Icon(Icons.photo_camera_outlined, size: 18),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          TextField(
            controller: _name,
            decoration: const InputDecoration(
              labelText: '昵称',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _height,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: '身高 cm',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _weight,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: '体重 kg',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            key: const Key('user-profile-age'),
            controller: _age,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: '年龄',
              suffixText: '岁',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            key: const Key('user-profile-gender'),
            initialValue: _gender,
            decoration: const InputDecoration(
              labelText: '性别',
              border: OutlineInputBorder(),
            ),
            items: const ['未设置', '女性', '男性', '非二元/其他']
                .map(
                  (value) => DropdownMenuItem(
                    value: value,
                    child: Text(value),
                  ),
                )
                .toList(),
            onChanged: (value) {
              if (value != null) {
                setState(() => _gender = value);
              }
            },
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _bodyType,
            decoration: const InputDecoration(
              labelText: '体型',
              border: OutlineInputBorder(),
            ),
            items: const ['偏瘦体型', '匀称体型', '健壮体型', '丰满体型']
                .map((value) => DropdownMenuItem(
                      value: value,
                      child: Text(value),
                    ))
                .toList(),
            onChanged: (value) {
              if (value != null) {
                setState(() => _bodyType = value);
              }
            },
          ),
          const SizedBox(height: 24),
          const _Label('喜欢风格'),
          Wrap(
            spacing: 8,
            children: [
              for (final style in _styleOptions)
                FilterChip(
                  label: Text(style),
                  selected: _styles.contains(style),
                  onSelected: (selected) => setState(
                    () => selected ? _styles.add(style) : _styles.remove(style),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 20),
          const _Label('品牌偏好'),
          Wrap(
            spacing: 8,
            children: [
              for (final brand in _brandOptions)
                FilterChip(
                  label: Text(brand),
                  selected: _brands.contains(brand),
                  onSelected: (selected) => setState(
                    () => selected ? _brands.add(brand) : _brands.remove(brand),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 20),
          _Label(
            '预算范围 ¥${_budget.start.toStringAsFixed(0)} - '
            '¥${_budget.end.toStringAsFixed(0)}',
          ),
          RangeSlider(
            values: _budget,
            min: 0,
            max: 3000,
            divisions: 30,
            onChanged: (value) => setState(() => _budget = value),
          ),
          const SizedBox(height: 20),
          FilledButton(
            key: const Key('save-user-profile'),
            onPressed: _saving ? null : _save,
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              backgroundColor: const Color(0xFF211E23),
            ),
            child: Text(_saving ? '保存中...' : '保存个人资料'),
          ),
        ],
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
      ),
    );
  }
}
