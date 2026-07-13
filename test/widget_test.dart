import 'package:fit_ai/app.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows four navigation destinations and changes pages',
      (tester) async {
    await tester.pumpWidget(const FitAIApp());

    expect(find.text('AI帮你打造专属穿搭'), findsOneWidget);
    expect(find.text('首页'), findsOneWidget);
    expect(find.text('AI穿搭'), findsOneWidget);
    expect(find.text('虚拟模特'), findsOneWidget);
    expect(find.text('我的账户'), findsOneWidget);

    await tester.tap(find.text('AI穿搭'));
    await tester.pumpAndSettle();
    expect(find.textContaining('我要参加婚礼'), findsOneWidget);
  });
}
