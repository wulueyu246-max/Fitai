import 'package:flutter/material.dart';

import '../models/user_consent.dart';
import '../services/consent_service.dart';
import '../services/user_data_deletion_service.dart';
import 'legal_consent_page.dart';
import 'legal_document_page.dart';

class PrivacyCenterPage extends StatefulWidget {
  const PrivacyCenterPage({
    this.consentService,
    this.deletionService,
    super.key,
  });

  final ConsentService? consentService;
  final UserDataDeletionService? deletionService;

  @override
  State<PrivacyCenterPage> createState() => _PrivacyCenterPageState();
}

class _PrivacyCenterPageState extends State<PrivacyCenterPage> {
  late final ConsentService _consentService;
  late final UserDataDeletionService _deletionService;
  UserConsent _consent = UserConsent.empty;
  bool _deleting = false;

  @override
  void initState() {
    super.initState();
    _consentService = widget.consentService ?? ConsentService.instance;
    _deletionService = widget.deletionService ?? UserDataDeletionService();
    _reload();
  }

  Future<void> _reload() async {
    final consent = await _consentService.load();
    if (mounted) setState(() => _consent = consent);
  }

  Future<void> _openConsent() async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => LegalConsentPage(service: _consentService),
      ),
    );
    await _reload();
  }

  Future<void> _deletePhotos() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除所有本地照片？'),
        content: const Text(
          '将删除本机保存的头像、身体照片和数字衣柜图片，并撤回照片处理授权。云端账号及云端照片请通过账号中心的“注销账号”删除。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const Key('confirm-delete-photos'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _deleting = true);
    final report = await _deletionService.deleteAllLocalPhotos();
    await _reload();
    if (!mounted) return;
    setState(() => _deleting = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('已删除 ${report.totalLocalRecordsRemoved} 条本地照片记录'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F1E8),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF6F1E8),
        title: const Text('隐私与数据中心'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          Card(
            child: Column(
              children: [
                ListTile(
                  key: const Key('open-legal-consent'),
                  onTap: _openConsent,
                  leading: const Icon(Icons.policy_outlined),
                  title: const Text('用户协议与隐私授权'),
                  subtitle: Text(
                    _consent.hasRequiredConsent ? '必要授权已完成' : '尚未完成全部授权',
                  ),
                  trailing: const Icon(Icons.chevron_right),
                ),
                const Divider(height: 1, indent: 56),
                _DocumentTile(
                  key: const Key('open-user-agreement'),
                  title: '用户协议',
                  icon: Icons.description_outlined,
                  type: LegalDocumentType.terms,
                ),
                const Divider(height: 1, indent: 56),
                _DocumentTile(
                  key: const Key('open-privacy-notice'),
                  title: '隐私说明',
                  icon: Icons.shield_outlined,
                  type: LegalDocumentType.privacy,
                ),
                const Divider(height: 1, indent: 56),
                ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('照片处理权限'),
                  subtitle: Text(
                    _consent.photoProcessingAllowed ? '已允许' : '未允许或已撤回',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Card(
            color: const Color(0xFFFFECEA),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '照片删除机制',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 7),
                  const Text(
                    '此操作删除本机照片记录。删除云端照片及完整账号数据，请返回账号中心选择“注销账号”。',
                    style: TextStyle(height: 1.5),
                  ),
                  const SizedBox(height: 14),
                  OutlinedButton.icon(
                    key: const Key('delete-all-user-photos'),
                    onPressed: _deleting ? null : _deletePhotos,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFA23B32),
                    ),
                    icon: const Icon(Icons.delete_forever_outlined),
                    label: Text(_deleting ? '正在删除…' : '删除所有本地照片'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DocumentTile extends StatelessWidget {
  const _DocumentTile({
    required this.title,
    required this.icon,
    required this.type,
    super.key,
  });

  final String title;
  final IconData icon;
  final LegalDocumentType type;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => LegalDocumentPage(type: type)),
      ),
      leading: Icon(icon),
      title: Text(title),
      trailing: const Icon(Icons.chevron_right),
    );
  }
}
