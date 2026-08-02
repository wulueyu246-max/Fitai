import 'package:flutter/material.dart';
import '../../../config/shupi_theme.dart';

class HomeHeader extends StatelessWidget {
  const HomeHeader({
    required this.searchController,
    required this.onSearchChanged,
    required this.onMessageTap,
    required this.onProfileTap,
    super.key,
  });

  final TextEditingController searchController;
  final ValueChanged<String> onSearchChanged;
  final VoidCallback onMessageTap;
  final VoidCallback onProfileTap;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 340;
        return Column(
          children: [
            Row(
              children: [
                Semantics(
                  header: true,
                  label: '树皮 Shupi',
                  child: compact
                      ? const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            ShupiMark(size: 32, showName: false),
                            SizedBox(width: 8),
                            Text(
                              '树皮',
                              style: TextStyle(
                                fontSize: 21,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        )
                      : const ShupiMark(size: 34),
                ),
                const Spacer(),
                IconButton(
                  tooltip: '消息',
                  visualDensity:
                      compact ? VisualDensity.compact : VisualDensity.standard,
                  onPressed: onMessageTap,
                  icon: const Icon(Icons.notifications_none_rounded),
                ),
                const SizedBox(width: 2),
                Semantics(
                  button: true,
                  label: '打开我的账户',
                  child: InkWell(
                    key: const Key('home-profile-button'),
                    customBorder: const CircleBorder(),
                    onTap: onProfileTap,
                    child: Container(
                      width: compact ? 36 : 38,
                      height: compact ? 36 : 38,
                      decoration: BoxDecoration(
                        color: const Color(0xFFDCE8DD),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                      child: const Icon(
                        Icons.person_rounded,
                        size: 21,
                        color: ShupiColors.forest,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            TextField(
              controller: searchController,
              onChanged: onSearchChanged,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: '搜索风格、商品、穿搭',
                hintStyle: const TextStyle(
                  color: Color(0xFF92908D),
                  fontSize: 14,
                ),
                prefixIcon: const Icon(
                  Icons.search_rounded,
                  color: Color(0xFF5D5A57),
                ),
                suffixIcon: searchController.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: '清除搜索',
                        onPressed: () {
                          searchController.clear();
                          onSearchChanged('');
                        },
                        icon: const Icon(Icons.close_rounded, size: 19),
                      ),
                filled: true,
                fillColor: Colors.white,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 13),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: const BorderSide(color: Color(0xFFEAE8E4)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: const BorderSide(
                    color: ShupiColors.forest,
                    width: 1.5,
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
