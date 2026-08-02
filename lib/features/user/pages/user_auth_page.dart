import 'package:flutter/material.dart';

import '../../../config/shupi_theme.dart';
import '../../../services/analytics_service.dart';
import '../services/user_session_controller.dart';

class UserAuthPage extends StatelessWidget {
  const UserAuthPage({
    required this.controller,
    this.initialRegister = false,
    super.key,
  });

  final UserSessionController controller;
  final bool initialRegister;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      initialIndex: initialRegister ? 1 : 0,
      child: Scaffold(
        backgroundColor: ShupiColors.ivory,
        appBar: AppBar(
          backgroundColor: ShupiColors.ivory,
          title: const Text('树皮账户'),
          bottom: const TabBar(
            tabs: [
              Tab(text: '登录'),
              Tab(text: '注册'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _AuthForm(controller: controller),
            _AuthForm(controller: controller, register: true),
          ],
        ),
      ),
    );
  }
}

class _AuthForm extends StatefulWidget {
  const _AuthForm({required this.controller, this.register = false});

  final UserSessionController controller;
  final bool register;

  @override
  State<_AuthForm> createState() => _AuthFormState();
}

class _AuthFormState extends State<_AuthForm> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _displayName = TextEditingController();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _obscure = true;
  bool _phoneMode = false;
  String? _debugCode;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _displayName.dispose();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_formKey.currentState?.validate() != true) {
      return;
    }
    final success = !widget.register && _phoneMode
        ? await widget.controller.loginWithPhoneCode(
            phone: _phone.text,
            code: _code.text,
          )
        : widget.register
            ? await widget.controller.register(
                email: _email.text,
                password: _password.text,
                displayName: _displayName.text,
              )
            : await widget.controller.login(
                email: _email.text,
                password: _password.text,
              );
    if (!mounted) {
      return;
    }
    if (success) {
      if (widget.register) {
        await LocalAnalyticsService.instance.track(
          'user_registered',
          userId: widget.controller.account?.id ?? 'local-demo-user',
        );
      }
      if (!mounted) {
        return;
      }
      Navigator.pop(context, true);
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(widget.controller.error ?? '操作失败'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _requestCode() async {
    if (!RegExp(r'^\+?[0-9\s-]{7,18}$').hasMatch(_phone.text.trim())) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入有效手机号')),
      );
      return;
    }
    final challenge = await widget.controller.requestPhoneCode(_phone.text);
    if (!mounted) return;
    setState(() => _debugCode = challenge?.debugCode);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          challenge == null
              ? widget.controller.error ?? '验证码发送失败'
              : challenge.debugCode == null
                  ? '验证码已发送，5分钟内有效'
                  : '测试验证码：${challenge.debugCode}',
        ),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 30, 24, 40),
      children: [
        const Icon(
          Icons.eco_rounded,
          size: 38,
          color: ShupiColors.forest,
        ),
        const SizedBox(height: 18),
        Text(
          widget.register ? '创建你的穿搭档案' : '继续你的个人穿搭旅程',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 8),
        const Text(
          '登录后可跨页面保存用户画像、穿搭偏好与推荐记录。',
          textAlign: TextAlign.center,
          style: TextStyle(color: Color(0xFF7C756F), height: 1.5),
        ),
        const SizedBox(height: 26),
        if (!widget.register) ...[
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(
                value: false,
                icon: Icon(Icons.mail_outline),
                label: Text('邮箱'),
              ),
              ButtonSegment(
                value: true,
                icon: Icon(Icons.phone_android_outlined),
                label: Text('手机号'),
              ),
            ],
            selected: {_phoneMode},
            onSelectionChanged: (value) {
              setState(() {
                _phoneMode = value.first;
                _debugCode = null;
              });
            },
          ),
          const SizedBox(height: 18),
        ],
        Form(
          key: _formKey,
          child: Column(
            children: [
              if (widget.register) ...[
                TextFormField(
                  key: const Key('auth-display-name'),
                  controller: _displayName,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    labelText: '昵称',
                    prefixIcon: Icon(Icons.person_outline),
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) =>
                      value == null || value.trim().isEmpty ? '请输入昵称' : null,
                ),
                const SizedBox(height: 14),
              ],
              if (!widget.register && _phoneMode) ...[
                TextFormField(
                  key: const Key('auth-phone'),
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  decoration: const InputDecoration(
                    labelText: '手机号',
                    prefixIcon: Icon(Icons.phone_android_outlined),
                  ),
                  validator: (value) => value != null &&
                          RegExp(r'^\+?[0-9\s-]{7,18}$').hasMatch(value.trim())
                      ? null
                      : '请输入有效手机号',
                ),
                const SizedBox(height: 14),
                TextFormField(
                  key: const Key('auth-phone-code'),
                  controller: _code,
                  keyboardType: TextInputType.number,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.oneTimeCode],
                  onFieldSubmitted: (_) => _submit(),
                  decoration: InputDecoration(
                    labelText: '验证码',
                    prefixIcon: const Icon(Icons.password_outlined),
                    suffixIcon: TextButton(
                      onPressed:
                          widget.controller.loading ? null : _requestCode,
                      child: const Text('获取验证码'),
                    ),
                  ),
                  validator: (value) =>
                      value != null && RegExp(r'^\d{6}$').hasMatch(value.trim())
                          ? null
                          : '请输入6位验证码',
                ),
                if (_debugCode != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    '本地测试验证码：$_debugCode',
                    style: const TextStyle(color: Color(0xFF6D746D)),
                  ),
                ],
              ] else ...[
                TextFormField(
                  key: const Key('auth-email'),
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  decoration: const InputDecoration(
                    labelText: '邮箱',
                    prefixIcon: Icon(Icons.mail_outline),
                  ),
                  validator: (value) =>
                      value != null && value.contains('@') ? null : '请输入有效邮箱',
                ),
                const SizedBox(height: 14),
                TextFormField(
                  key: const Key('auth-password'),
                  controller: _password,
                  obscureText: _obscure,
                  onFieldSubmitted: (_) => _submit(),
                  autofillHints: const [AutofillHints.password],
                  decoration: InputDecoration(
                    labelText: '密码（至少8位）',
                    prefixIcon: const Icon(Icons.lock_outline),
                    suffixIcon: IconButton(
                      onPressed: () => setState(() => _obscure = !_obscure),
                      icon: Icon(
                        _obscure
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                      ),
                    ),
                  ),
                  validator: (value) =>
                      value != null && value.length >= 8 ? null : '密码至少需要8位',
                ),
              ],
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ListenableBuilder(
                  listenable: widget.controller,
                  builder: (context, _) => FilledButton(
                    key: Key(
                      widget.register ? 'submit-register' : 'submit-login',
                    ),
                    onPressed: widget.controller.loading ? null : _submit,
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      backgroundColor: ShupiColors.forest,
                    ),
                    child: Text(
                      widget.controller.loading
                          ? '处理中...'
                          : widget.register
                              ? '注册并登录'
                              : _phoneMode
                                  ? '验证码登录'
                                  : '登录',
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
