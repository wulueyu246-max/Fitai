import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;

abstract final class ShupiColors {
  static const forest = Color(0xFF244C3A);
  static const forestDark = Color(0xFF17382A);
  static const leaf = Color(0xFF5F7D68);
  static const wood = Color(0xFF8A6246);
  static const sand = Color(0xFFE5D8C7);
  static const ivory = Color(0xFFF7F3EA);
  static const surface = Color(0xFFFFFCF6);
  static const ink = Color(0xFF20251F);
  static const muted = Color(0xFF6D746D);
}

abstract final class ShupiTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: ShupiColors.forest,
      brightness: Brightness.light,
      surface: ShupiColors.surface,
    ).copyWith(
      primary: ShupiColors.forest,
      secondary: ShupiColors.wood,
      surface: ShupiColors.surface,
      onSurface: ShupiColors.ink,
      outline: const Color(0xFFD8D2C6),
    );

    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      scaffoldBackgroundColor: ShupiColors.ivory,
      splashFactory: InkSparkle.splashFactory,
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        },
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: ShupiColors.ivory,
        foregroundColor: ShupiColors.ink,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: ShupiColors.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(22),
          side: const BorderSide(color: Color(0xFFE8E1D5)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: ShupiColors.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xFFD8D2C6)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xFFD8D2C6)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: ShupiColors.forest, width: 1.5),
        ),
      ),
      navigationBarTheme: const NavigationBarThemeData(
        backgroundColor: ShupiColors.surface,
        indicatorColor: Color(0xFFDCE8DD),
        height: 68,
        elevation: 0,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: ShupiColors.forest,
          foregroundColor: Colors.white,
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(15),
          ),
        ),
      ),
    );
  }
}

class ShupiMark extends StatelessWidget {
  const ShupiMark({this.size = 38, this.showName = true, super.key});

  final double size;
  final bool showName;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: size,
          height: size,
          decoration: const BoxDecoration(
            color: ShupiColors.forest,
            shape: BoxShape.circle,
          ),
          child: Icon(Icons.eco_rounded, color: Colors.white, size: size * .55),
        ),
        if (showName) ...[
          const SizedBox(width: 10),
          const Text(
            '树皮 Shupi',
            style: TextStyle(
              color: ShupiColors.ink,
              fontWeight: FontWeight.w900,
              letterSpacing: -.5,
              fontSize: 23,
            ),
          ),
        ],
      ],
    );
  }
}
