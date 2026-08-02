import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../models/digital_wardrobe_item.dart';
import '../models/digital_wardrobe_look.dart';
import '../services/digital_wardrobe_service.dart';

class DigitalWardrobePage extends StatefulWidget {
  const DigitalWardrobePage({this.service, super.key});

  final DigitalWardrobeService? service;

  @override
  State<DigitalWardrobePage> createState() => _DigitalWardrobePageState();
}

class _DigitalWardrobePageState extends State<DigitalWardrobePage> {
  late final DigitalWardrobeService _service;
  final ImagePicker _picker = ImagePicker();
  List<DigitalWardrobeItem> _items = const [];
  bool _loading = true;
  bool _recognizing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? DigitalWardrobeService();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await _service.load();
      if (mounted) {
        setState(() {
          _items = items;
          _loading = false;
          _error = null;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = '衣橱加载失败，请重试';
        });
      }
    }
  }

  Future<void> _upload() async {
    final image = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 78,
      maxWidth: 1600,
    );
    if (image == null || !mounted) {
      return;
    }
    setState(() {
      _recognizing = true;
      _error = null;
    });
    try {
      await _service.addUploadedClothing(
        imageBytes: await image.readAsBytes(),
        fileName: image.name,
      );
      await _load();
    } catch (_) {
      if (mounted) {
        setState(() => _error = '图片识别失败，请换一张清晰的单品照片');
      }
    } finally {
      if (mounted) {
        setState(() => _recognizing = false);
      }
    }
  }

  Future<void> _autoMatch() async {
    final look = await _service.autoMatch();
    if (!mounted) {
      return;
    }
    if (look == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('先上传一件自己的衣服')),
      );
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => _AutoMatchSheet(look: look),
    );
  }

  Future<void> _remove(DigitalWardrobeItem item) async {
    await _service.remove(item.id);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F6F3),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF7F6F3),
        title: const Text('我的数字衣橱'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 40),
        children: [
          _WardrobeHero(
            recognizing: _recognizing,
            onUpload: _recognizing ? null : _upload,
            onAutoMatch: _autoMatch,
          ),
          if (_error case final message?) ...[
            const SizedBox(height: 12),
            Text(message, style: const TextStyle(color: Colors.redAccent)),
          ],
          const SizedBox(height: 28),
          const Text(
            '我的单品',
            style: TextStyle(fontSize: 23, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 5),
          const Text(
            '上传照片后由 Mock 视觉识别生成分类、颜色与材质标签',
            style: TextStyle(color: Color(0xFF7E7771)),
          ),
          const SizedBox(height: 16),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else if (_items.isEmpty)
            const _DigitalWardrobeEmpty()
          else
            LayoutBuilder(
              builder: (context, constraints) {
                final columns = constraints.maxWidth >= 760 ? 4 : 2;
                const gap = 12.0;
                final width =
                    (constraints.maxWidth - gap * (columns - 1)) / columns;
                return Wrap(
                  spacing: gap,
                  runSpacing: 14,
                  children: [
                    for (final item in _items)
                      SizedBox(
                        width: width,
                        child: _WardrobeItemCard(
                          item: item,
                          onRemove: () => _remove(item),
                        ),
                      ),
                  ],
                );
              },
            ),
        ],
      ),
    );
  }
}

class _WardrobeHero extends StatelessWidget {
  const _WardrobeHero({
    required this.recognizing,
    required this.onUpload,
    required this.onAutoMatch,
  });

  final bool recognizing;
  final VoidCallback? onUpload;
  final VoidCallback onAutoMatch;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF1D1B20), Color(0xFF6F5F7B)],
        ),
        borderRadius: BorderRadius.circular(28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.checkroom_rounded, color: Colors.white, size: 32),
          const SizedBox(height: 18),
          const Text(
            '让自己的衣服也进入 AI 搭配',
            style: TextStyle(
              color: Colors.white,
              fontSize: 25,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            '上传单品 → AI识别 → 保存衣橱 → 自动生成搭配',
            style: TextStyle(color: Color(0xFFDCD3E1), height: 1.5),
          ),
          const SizedBox(height: 20),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              FilledButton.icon(
                key: const Key('upload-wardrobe-item'),
                onPressed: onUpload,
                icon: recognizing
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add_photo_alternate_outlined),
                label: Text(recognizing ? '正在识别' : '上传衣服'),
              ),
              OutlinedButton.icon(
                key: const Key('auto-match-wardrobe'),
                onPressed: onAutoMatch,
                icon: const Icon(Icons.auto_awesome_rounded),
                label: const Text('自动搭配'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Colors.white54),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DigitalWardrobeEmpty extends StatelessWidget {
  const _DigitalWardrobeEmpty();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 42, horizontal: 20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: const Column(
        children: [
          Icon(Icons.add_photo_alternate_outlined, size: 40),
          SizedBox(height: 12),
          Text('衣橱还是空的', style: TextStyle(fontWeight: FontWeight.w900)),
          SizedBox(height: 5),
          Text('上传一张单品照片，建立你的个人 AI 衣橱'),
        ],
      ),
    );
  }
}

class _WardrobeItemCard extends StatelessWidget {
  const _WardrobeItemCard({required this.item, required this.onRemove});

  final DigitalWardrobeItem item;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 4 / 5,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.memory(
                base64Decode(item.imageBase64),
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => const ColoredBox(
                  color: Color(0xFFF0ECE8),
                  child: Icon(Icons.checkroom_outlined),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            item.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 5),
          Text(
            '${item.category} · ${item.color} · ${item.material}',
            style: const TextStyle(color: Color(0xFF7C756F), fontSize: 11),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: IconButton(
              tooltip: '删除',
              onPressed: onRemove,
              icon: const Icon(Icons.delete_outline_rounded, size: 19),
            ),
          ),
        ],
      ),
    );
  }
}

class _AutoMatchSheet extends StatelessWidget {
  const _AutoMatchSheet({required this.look});

  final DigitalWardrobeLook look;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 4, 22, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              look.title,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 12),
            for (final item in look.items)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const CircleAvatar(
                  child: Icon(Icons.checkroom_rounded),
                ),
                title: Text(item.name),
                subtitle: Text('${item.category} · ${item.style}'),
              ),
            const SizedBox(height: 8),
            Text(look.aiReason, style: const TextStyle(height: 1.5)),
          ],
        ),
      ),
    );
  }
}
