import 'package:fit_ai/pages/ai_outfit_page.dart';
import 'package:fit_ai/services/consent_service.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('all three Android photo entries expose the Files picker', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    try {
      final consentService = ConsentService();
      await consentService.grantRequiredConsent();

      await tester.pumpWidget(
        MaterialApp(home: AiOutfitPage(consentService: consentService)),
      );
      await tester.pump(const Duration(milliseconds: 300));

      for (final role in const ['front', 'side', 'back']) {
        final entry = find.byKey(Key('photo-upload-$role'));
        await tester.ensureVisible(entry);
        await tester.tap(entry);
        await tester.pumpAndSettle();

        expect(find.text('从文件选择'), findsOneWidget);
        expect(
          find.text('支持 JPG、JPEG、PNG，可从 Pictures 或 Downloads 选择'),
          findsOneWidget,
        );

        await tester.tapAt(const Offset(4, 4));
        await tester.pumpAndSettle();
      }
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });
}
