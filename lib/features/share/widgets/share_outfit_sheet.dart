import 'package:flutter/material.dart';

import '../../../models/outfit_plan.dart';
import '../models/share_outfit.dart';
import '../services/share_outfit_service.dart';
import 'share_outfit_card.dart';

Future<void> showShareOutfitSheet(
  BuildContext context, {
  required OutfitPlan outfitPlan,
  String? tryOnImage,
  String userName = '我的AI衣橱',
  String? avatarBase64,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _ShareOutfitSheet(
      outfit: ShareOutfit(
        id: 'share-${DateTime.now().microsecondsSinceEpoch}',
        userName: userName,
        outfitPlan: outfitPlan,
        tryOnImage: tryOnImage,
        avatarBase64: avatarBase64,
        generatedAt: DateTime.now(),
      ),
    ),
  );
}

class _ShareOutfitSheet extends StatefulWidget {
  const _ShareOutfitSheet({required this.outfit});

  final ShareOutfit outfit;

  @override
  State<_ShareOutfitSheet> createState() => _ShareOutfitSheetState();
}

class _ShareOutfitSheetState extends State<_ShareOutfitSheet> {
  final GlobalKey _cardKey = GlobalKey();
  final ShareOutfitService _service = const ShareOutfitService();
  bool _working = false;

  Future<void> _run(
    Future<void> Function() action,
    String successMessage,
  ) async {
    if (_working) {
      return;
    }
    setState(() => _working = true);
    try {
      await action();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(successMessage),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('穿搭卡片处理失败，请稍后重试'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _working = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF7F5F2),
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      clipBehavior: Clip.antiAlias,
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 28),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: const Color(0xFFD2CEC8),
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    '分享我的AI穿搭',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 5),
                  const Text(
                    '生成一张可保存、可分享的树皮穿搭卡片',
                    style: TextStyle(color: Color(0xFF7A746E)),
                  ),
                  const SizedBox(height: 18),
                  RepaintBoundary(
                    key: _cardKey,
                    child: ShareOutfitCard(outfit: widget.outfit),
                  ),
                  const SizedBox(height: 18),
                  if (_working) const LinearProgressIndicator(minHeight: 2),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          key: const Key('save-outfit-card'),
                          onPressed: _working
                              ? null
                              : () => _run(
                                    () => _service.saveCard(
                                      repaintBoundaryKey: _cardKey,
                                      outfit: widget.outfit,
                                    ),
                                    '穿搭卡片已保存',
                                  ),
                          icon: const Icon(Icons.download_rounded),
                          label: const Text('保存图片'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: FilledButton.icon(
                          key: const Key('share-outfit-card'),
                          onPressed: _working
                              ? null
                              : () => _run(
                                    () async {
                                      await _service.shareCard(
                                        repaintBoundaryKey: _cardKey,
                                        outfit: widget.outfit,
                                      );
                                    },
                                    '已打开系统分享',
                                  ),
                          icon: const Icon(Icons.ios_share_rounded),
                          label: const Text('立即分享'),
                        ),
                      ),
                    ],
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
