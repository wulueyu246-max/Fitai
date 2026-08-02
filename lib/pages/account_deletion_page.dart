import 'package:flutter/material.dart';

import '../features/user/services/user_session_controller.dart';
import '../services/consent_service.dart';
import '../services/digital_wardrobe_service.dart';
import '../services/favorite_service.dart';
import '../services/user_profile_service.dart';

class AccountDeletionPage extends StatefulWidget {
  const AccountDeletionPage({
    required this.sessionController,
    this.favoriteService,
    this.profileService,
    this.wardrobeService,
    this.consentService,
    super.key,
  });

  final UserSessionController sessionController;
  final FavoriteService? favoriteService;
  final UserProfileService? profileService;
  final DigitalWardrobeService? wardrobeService;
  final ConsentService? consentService;

  @override
  State<AccountDeletionPage> createState() => _AccountDeletionPageState();
}

class _AccountDeletionPageState extends State<AccountDeletionPage> {
  final _confirmationController = TextEditingController();
  bool _deleting = false;
  String? _error;

  bool get _confirmed => _confirmationController.text.trim() == '注销账号';

  @override
  void dispose() {
    _confirmationController.dispose();
    super.dispose();
  }

  Future<void> _deleteAccount() async {
    if (!_confirmed || _deleting) return;
    setState(() {
      _deleting = true;
      _error = null;
    });

    final deleted = await widget.sessionController.deleteAccount();
    if (!deleted) {
      if (mounted) {
        setState(() {
          _deleting = false;
          _error = widget.sessionController.error ?? '账号注销失败，请稍后重试';
        });
      }
      return;
    }

    try {
      await Future.wait([
        (widget.favoriteService ?? FavoriteService.instance).clearAll(),
        (widget.profileService ?? UserProfileService()).clear(),
        (widget.wardrobeService ?? DigitalWardrobeService()).clearAll(),
        (widget.consentService ?? ConsentService.instance).clear(),
      ]);
    } catch (_) {
      // The server account is already deleted. Local stores retry naturally on
      // the next launch and must not make the destructive request look failed.
    }
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F1E8),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF6F1E8),
        title: const Text('注销账号'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
        children: [
          const Icon(
            Icons.warning_amber_rounded,
            size: 48,
            color: Color(0xFFA23B32),
          ),
          const SizedBox(height: 16),
          Text(
            '注销后无法恢复',
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 16),
          const Card(
            child: Padding(
              padding: EdgeInsets.all(18),
              child: Text(
                '账号资料、云端衣柜、收藏、试穿历史、行为记录和已上传照片将被删除。'
                '已在品牌或联盟页面完成的订单不由树皮保存，请联系对应平台处理。',
                style: TextStyle(height: 1.65),
              ),
            ),
          ),
          const SizedBox(height: 18),
          TextField(
            key: const Key('account-deletion-confirmation'),
            controller: _confirmationController,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: '输入“注销账号”确认',
              border: OutlineInputBorder(),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Color(0xFFA23B32))),
          ],
          const SizedBox(height: 20),
          FilledButton(
            key: const Key('confirm-account-deletion'),
            onPressed: _confirmed && !_deleting ? _deleteAccount : null,
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFA23B32),
              minimumSize: const Size.fromHeight(50),
            ),
            child: Text(_deleting ? '正在注销…' : '永久注销账号'),
          ),
        ],
      ),
    );
  }
}
