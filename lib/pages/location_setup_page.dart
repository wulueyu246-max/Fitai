import 'package:flutter/material.dart';

import '../config/shupi_theme.dart';
import '../models/app_location.dart';
import '../services/location_service.dart';

class LocationSetupPage extends StatefulWidget {
  const LocationSetupPage({
    required this.onComplete,
    required this.service,
    super.key,
  });

  final ValueChanged<AppLocation> onComplete;
  final LocationService service;

  @override
  State<LocationSetupPage> createState() => _LocationSetupPageState();
}

class _LocationSetupPageState extends State<LocationSetupPage> {
  final _cityController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _cityController.dispose();
    super.dispose();
  }

  Future<void> _locate() => _run(widget.service.useDeviceLocation);

  Future<void> _chooseCity() async {
    FocusScope.of(context).unfocus();
    await _run(() => widget.service.resolveCity(_cityController.text));
  }

  Future<void> _run(Future<AppLocation> Function() action) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final location = await action();
      if (mounted) widget.onComplete(location);
    } on LocationException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = '暂时无法确定位置，请手动选择城市');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 40),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const ShupiMark(),
                  const SizedBox(height: 42),
                  Container(
                    width: 68,
                    height: 68,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      color: Color(0xFFDCE8DD),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.location_on_outlined,
                      color: ShupiColors.forest,
                      size: 32,
                    ),
                  ),
                  const SizedBox(height: 22),
                  Text(
                    '让穿搭适应你所在的城市',
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w900,
                          height: 1.15,
                        ),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    '树皮只会保存国家、城市和近似坐标，用于获取实时天气并调整穿搭建议，不会持续追踪你的位置。',
                    style: TextStyle(
                      color: ShupiColors.muted,
                      height: 1.6,
                      fontSize: 15,
                    ),
                  ),
                  const SizedBox(height: 26),
                  FilledButton.icon(
                    key: const Key('use-device-location'),
                    onPressed: _loading ? null : _locate,
                    icon: _loading
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.my_location_rounded),
                    label: const Text('允许定位并自动识别'),
                  ),
                  const SizedBox(height: 18),
                  const Row(
                    children: [
                      Expanded(child: Divider()),
                      Padding(
                        padding: EdgeInsets.symmetric(horizontal: 12),
                        child: Text('或手动选择'),
                      ),
                      Expanded(child: Divider()),
                    ],
                  ),
                  const SizedBox(height: 18),
                  TextField(
                    key: const Key('manual-city-input'),
                    controller: _cityController,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _chooseCity(),
                    decoration: const InputDecoration(
                      labelText: '城市',
                      hintText: '例如：上海、深圳、London',
                      prefixIcon: Icon(Icons.location_city_outlined),
                    ),
                  ),
                  if (_error case final message?) ...[
                    const SizedBox(height: 12),
                    Text(
                      message,
                      key: const Key('location-error'),
                      style: const TextStyle(color: Colors.redAccent),
                    ),
                  ],
                  const SizedBox(height: 14),
                  OutlinedButton(
                    key: const Key('confirm-manual-city'),
                    onPressed: _loading ? null : _chooseCity,
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                    ),
                    child: const Text('使用这个城市'),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    '你可以稍后在账户中心重新选择城市。',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: ShupiColors.muted, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
