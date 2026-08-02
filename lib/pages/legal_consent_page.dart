import 'package:flutter/material.dart';

import '../models/user_consent.dart';
import '../services/consent_service.dart';

class LegalConsentPage extends StatefulWidget {
  const LegalConsentPage({
    this.service,
    this.requirePhotoConsent = false,
    super.key,
  });

  final ConsentService? service;
  final bool requirePhotoConsent;

  @override
  State<LegalConsentPage> createState() => _LegalConsentPageState();
}

class _LegalConsentPageState extends State<LegalConsentPage> {
  late final ConsentService _service;
  UserConsent _consent = UserConsent.empty;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ConsentService.instance;
    _load();
  }

  Future<void> _load() async {
    final consent = await _service.load();
    if (mounted) {
      setState(() {
        _consent = consent;
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    if (!_consent.acceptedTerms ||
        !_consent.acceptedPrivacy ||
        (widget.requirePhotoConsent && !_consent.photoProcessingAllowed)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请先完成必要授权')),
      );
      return;
    }
    await _service.save(_consent);
    if (mounted) {
      Navigator.pop(context, _consent.hasRequiredConsent);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F6F3),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF7F6F3),
        title: const Text('用户协议与隐私授权'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
              children: [
                const _LegalSection(
                  title: '树皮用户协议',
                  content: '树皮提供穿搭分析、商品推荐和虚拟试穿服务。'
                      '当前商业测试中的商品、库存、购买和试穿部分可能为 Mock；'
                      '用户应确认提交内容拥有合法使用权。',
                ),
                const SizedBox(height: 14),
                const _LegalSection(
                  title: '隐私说明',
                  content: '身材数据、头像和全身照片属于敏感个人信息。'
                      '仅为生成穿搭和试穿结果处理，不应写入普通日志；'
                      '正式上线前必须提供存储期限、第三方处理方和账号注销说明。',
                ),
                const SizedBox(height: 14),
                const _LegalSection(
                  title: '照片处理授权',
                  content: '照片可能被发送到配置的 AI 服务商完成视觉分析。'
                      '你可以随时撤回授权并在隐私中心删除本地照片数据；'
                      '撤回后将无法继续生成基于照片的分析。',
                ),
                const SizedBox(height: 18),
                CheckboxListTile(
                  key: const Key('consent-terms'),
                  contentPadding: EdgeInsets.zero,
                  value: _consent.acceptedTerms,
                  onChanged: (value) => setState(
                    () => _consent =
                        _consent.copyWith(acceptedTerms: value ?? false),
                  ),
                  title: const Text('我已阅读并同意用户协议'),
                ),
                CheckboxListTile(
                  key: const Key('consent-privacy'),
                  contentPadding: EdgeInsets.zero,
                  value: _consent.acceptedPrivacy,
                  onChanged: (value) => setState(
                    () => _consent =
                        _consent.copyWith(acceptedPrivacy: value ?? false),
                  ),
                  title: const Text('我已阅读并同意隐私说明'),
                ),
                CheckboxListTile(
                  key: const Key('consent-photo'),
                  contentPadding: EdgeInsets.zero,
                  value: _consent.photoProcessingAllowed,
                  onChanged: (value) => setState(
                    () => _consent = _consent.copyWith(
                      photoProcessingAllowed: value ?? false,
                    ),
                  ),
                  title: const Text('允许处理照片以生成AI穿搭和试穿结果'),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('save-consent'),
                  onPressed: _save,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF211E23),
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                  child: const Text('保存授权'),
                ),
              ],
            ),
    );
  }
}

class _LegalSection extends StatelessWidget {
  const _LegalSection({required this.title, required this.content});

  final String title;
  final String content;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          Text(content, style: const TextStyle(height: 1.6)),
        ],
      ),
    );
  }
}
