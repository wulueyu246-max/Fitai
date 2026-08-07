import 'dart:convert';

import 'package:flutter/material.dart';

import '../features/user/pages/user_auth_page.dart';
import '../features/user/pages/user_profile_page.dart';
import '../features/user/services/user_session_controller.dart';
import '../services/location_service.dart';
import '../repositories/wardrobe_repository.dart';
import 'account_deletion_page.dart';
import 'location_setup_page.dart';
import 'privacy_center_page.dart';
import 'product_management_page.dart';
import 'wardrobe_page.dart';

class AccountPage extends StatefulWidget {
  const AccountPage({
    this.onOpenWardrobe,
    this.sessionController,
    this.wardrobeRepository,
    this.showInternalTools,
    super.key,
  });

  final VoidCallback? onOpenWardrobe;
  final UserSessionController? sessionController;
  final WardrobeRepository? wardrobeRepository;
  final bool? showInternalTools;

  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  late final UserSessionController _session;

  bool get _showInternalTools =>
      widget.showInternalTools ??
      const bool.fromEnvironment('SHOW_INTERNAL_TOOLS');

  @override
  void initState() {
    super.initState();
    _session = widget.sessionController ?? UserSessionController.instance;
    _session.addListener(_refresh);
    _session.ensureLoaded();
  }

  @override
  void dispose() {
    _session.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _openAuth({bool register = false}) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => UserAuthPage(
          controller: _session,
          initialRegister: register,
        ),
      ),
    );
  }

  Future<void> _openProfile() async {
    final account = _session.account;
    if (account == null) {
      await _openAuth();
      return;
    }
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => UserProfilePage(
          controller: _session,
          account: account,
        ),
      ),
    );
  }

  Future<void> _changeCity() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (routeContext) => LocationSetupPage(
          service: DeviceLocationService(),
          onComplete: (_) {
            Navigator.of(routeContext).pop();
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('城市与天气位置已更新')),
            );
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final account = _session.account;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          '账户中心',
          style: Theme.of(context)
              .textTheme
              .headlineMedium
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 24),
        Card(
          child: Column(
            children: [
              ListTile(
                key: const Key('open-user-profile'),
                onTap: _openProfile,
                leading: CircleAvatar(
                  backgroundColor: const Color(0xFFE9E1ED),
                  backgroundImage: account?.avatarBase64 == null
                      ? null
                      : MemoryImage(base64Decode(account!.avatarBase64!)),
                  child: account?.avatarBase64 == null
                      ? const Icon(Icons.person_outline)
                      : null,
                ),
                title: const Text('用户名'),
                subtitle: Text(
                  account == null
                      ? '游客 · 登录后保存个人穿搭档案'
                      : '${account.displayName} · '
                          '${account.phone ?? account.email}',
                ),
                trailing: const Icon(Icons.chevron_right),
              ),
              if (account == null) ...[
                const Divider(height: 1, indent: 56),
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          key: const Key('open-login'),
                          onPressed: _openAuth,
                          child: const Text('登录'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: FilledButton(
                          key: const Key('open-register'),
                          onPressed: () => _openAuth(register: true),
                          child: const Text('注册'),
                        ),
                      ),
                    ],
                  ),
                ),
              ] else ...[
                const Divider(height: 1, indent: 56),
                _FashionIdentityTile(
                  bodyType: account.bodyType,
                  styles: account.likedStyles,
                ),
              ],
              const Divider(height: 1, indent: 56),
              ListTile(
                key: const Key('open-wardrobe'),
                onTap: widget.onOpenWardrobe ??
                    () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => WardrobePage(
                              repository: widget.wardrobeRepository,
                            ),
                          ),
                        ),
                leading: const Icon(Icons.checkroom_outlined),
                title: const Text('我的衣橱'),
                subtitle: const Text('收藏、穿搭方案与试穿记录'),
                trailing: const Icon(Icons.chevron_right),
              ),
              const Divider(height: 1, indent: 56),
              ListTile(
                key: const Key('change-weather-city'),
                onTap: _changeCity,
                leading: const Icon(Icons.location_on_outlined),
                title: const Text('城市与天气'),
                subtitle: const Text('自动定位或手动更新推荐城市'),
                trailing: const Icon(Icons.chevron_right),
              ),
              const Divider(height: 1, indent: 56),
              ListTile(
                key: const Key('open-privacy-center'),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const PrivacyCenterPage(),
                  ),
                ),
                leading: const Icon(Icons.privacy_tip_outlined),
                title: const Text('隐私与数据中心'),
                subtitle: const Text('用户协议、照片授权与数据删除'),
                trailing: const Icon(Icons.chevron_right),
              ),
              if (_showInternalTools) ...[
                const Divider(height: 1, indent: 56),
                ListTile(
                  key: const Key('open-product-management'),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => const ProductManagementPage(),
                    ),
                  ),
                  leading: const Icon(Icons.inventory_2_outlined),
                  title: const Text('商品管理'),
                  subtitle: const Text('内部测试：查看和调整 Mock 商品状态'),
                  trailing: const Icon(Icons.chevron_right),
                ),
              ],
              if (account != null) ...[
                const Divider(height: 1, indent: 56),
                ListTile(
                  key: const Key('open-account-deletion'),
                  onTap: () async {
                    final deleted = await Navigator.of(context).push<bool>(
                      MaterialPageRoute(
                        builder: (_) => AccountDeletionPage(
                          sessionController: _session,
                        ),
                      ),
                    );
                    if (deleted == true && context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('账号已注销，相关数据已删除')),
                      );
                    }
                  },
                  leading: const Icon(
                    Icons.person_remove_outlined,
                    color: Color(0xFFA23B32),
                  ),
                  title: const Text(
                    '注销账号',
                    style: TextStyle(color: Color(0xFFA23B32)),
                  ),
                  subtitle: const Text('永久删除账号、云端照片和衣柜数据'),
                  trailing: const Icon(Icons.chevron_right),
                ),
                const Divider(height: 1, indent: 56),
                ListTile(
                  key: const Key('logout-user'),
                  onTap: _session.logout,
                  leading: const Icon(Icons.logout_rounded),
                  title: const Text('退出登录'),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _FashionIdentityTile extends StatelessWidget {
  const _FashionIdentityTile({
    required this.bodyType,
    required this.styles,
  });

  final String bodyType;
  final List<String> styles;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.face_retouching_natural_outlined),
      title: const Text('AI个人穿搭画像'),
      subtitle: Text(
        '$bodyType · ${styles.take(2).join(' / ')}',
      ),
      trailing: const Icon(Icons.chevron_right),
    );
  }
}
