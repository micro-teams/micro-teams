// The registration form's own behaviour — the parts that are decisions rather than layout.
//
// This screen existed in the React client and not in the first Flutter cut, and its absence was
// the one gap that made a brand-new deployment unusable: no way to create the first user.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/auth/register_screen.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';
import 'package:microteams/src/common/ui/theme.dart';

/// Records what was asked of the identity service, and can refuse.
class _FakeAuth implements AuthApi {
  final List<String> codesSentTo = [];
  Object? refuseCodeWith;

  @override
  Future<void> sendEmailVerifyCode(String email) async {
    if (refuseCodeWith != null) throw refuseCodeWith!;
    codesSentTo.add(email);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
    '${invocation.memberName} is not part of this test',
  );
}

Future<void> _pump(WidgetTester tester, _FakeAuth auth) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        endpointsProvider.overrideWithValue(
          const Endpoints(origin: 'http://backend.test'),
        ),
        authApiProvider.overrideWithValue(auth),
      ],
      child: MaterialApp(
        theme: darkTheme(),
        home: RegisterScreen(onSignIn: () {}),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('the nickname follows the username until it is edited', (
    tester,
  ) async {
    // Most people want them the same and should not type it twice; the moment they disagree, the
    // mirror has to stop, or editing the username would silently overwrite a chosen nickname.
    await _pump(tester, _FakeAuth());
    final fields = find.byType(TextField);

    await tester.enterText(fields.at(0), 'probe');
    await tester.pump();
    expect(
      tester.widget<TextField>(fields.at(1)).controller!.text,
      'probe',
      reason: 'the nickname mirrors the username',
    );

    await tester.enterText(fields.at(1), 'Probe Human');
    await tester.pump();
    await tester.enterText(fields.at(0), 'probe2');
    await tester.pump();
    expect(
      tester.widget<TextField>(fields.at(1)).controller!.text,
      'Probe Human',
      reason: 'an edited nickname stops following',
    );
  });

  testWidgets('the submit button stays disabled until every rule is met', (
    tester,
  ) async {
    await _pump(tester, _FakeAuth());
    final create = find.widgetWithText(FilledButton, 'create account');
    expect(tester.widget<FilledButton>(create).onPressed, isNull);

    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), 'probe');
    await tester.enterText(fields.at(2), 'probe-pass-123');
    await tester.enterText(fields.at(3), 'probe-pass-123');
    await tester.enterText(fields.at(4), 'probe@example.com');
    await tester.pump();
    expect(
      tester.widget<FilledButton>(create).onPressed,
      isNull,
      reason: 'no verification code yet',
    );

    await tester.enterText(fields.at(5), '123456');
    await tester.pump();
    expect(tester.widget<FilledButton>(create).onPressed, isNotNull);
  });

  testWidgets('a password that does not match its confirmation says so', (
    tester,
  ) async {
    await _pump(tester, _FakeAuth());
    final fields = find.byType(TextField);
    await tester.enterText(fields.at(2), 'probe-pass-123');
    await tester.enterText(fields.at(3), 'probe-pass-124');
    await tester.pump();
    expect(find.text('the two passwords do not match'), findsOneWidget);
  });

  testWidgets(
    'sending a code asks the identity service, once there is an address',
    (tester) async {
      final auth = _FakeAuth();
      await _pump(tester, auth);

      final send = find.widgetWithText(FilledButton, 'send code');
      expect(
        tester.widget<FilledButton>(send).onPressed,
        isNull,
        reason: 'nothing to send it to yet',
      );

      await tester.enterText(find.byType(TextField).at(4), 'probe@example.com');
      await tester.pump();
      await tester.ensureVisible(send);
      await tester.tap(send);
      await tester.pumpAndSettle();

      expect(auth.codesSentTo, ['probe@example.com']);
      expect(find.text('a code is on its way to that address'), findsOneWidget);
    },
  );

  testWidgets('a refused code is named, not swallowed', (tester) async {
    // The usual cause is a deployment with no SMTP configured, and without a code there is no way
    // forward at all — so silence here is the difference between "I am stuck" and "I know why".
    final auth = _FakeAuth()..refuseCodeWith = StateError('no mail transport');
    await _pump(tester, auth);

    await tester.enterText(find.byType(TextField).at(4), 'probe@example.com');
    await tester.pump();
    final send = find.widgetWithText(FilledButton, 'send code');
    await tester.ensureVisible(send);
    await tester.tap(send);
    await tester.pumpAndSettle();

    expect(find.textContaining('no mail transport'), findsOneWidget);
  });
}
