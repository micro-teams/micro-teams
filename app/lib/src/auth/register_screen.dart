/// Make an account.
///
/// The only screen besides login that exists before there is a session, and the one whose absence
/// was a real hole: a brand-new deployment had no way to create its first user from the interface
/// at all. Everything else could wait for the migration; this could not.
///
/// Two things it does that a plainer form would not, both carried over from the React version
/// because both were decisions:
///
///   * the nickname mirrors the username until somebody edits the nickname. Most people want them
///     the same and should not have to type it twice; the moment they disagree, the mirror stops.
///   * the password's four rules are shown individually, ticking off as they are met, rather than
///     one "invalid password". A form that says only that makes people guess.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../common/ui/theme.dart';
import '../providers.dart';
import 'validation.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({required this.onSignIn, super.key});

  /// Back to the login screen. The router owns navigation; this screen reports intent.
  final VoidCallback onSignIn;

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _username = TextEditingController();
  final _nickname = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  final _email = TextEditingController();
  final _code = TextEditingController();

  /// Once the nickname has been edited by hand, it stops following the username.
  bool _nicknameTouched = false;

  /// True only while THIS class is writing the nickname. Without it the mirror cannot tell its own
  /// write from the user's, and the first hand-typed nickname is overwritten on the next keystroke
  /// in the username — which is exactly what happened, and what the test now pins.
  bool _mirroring = false;

  bool _busy = false;
  bool _sendingCode = false;
  bool _codeSent = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Rebuild as they type: the rule checklist and the submit button are both derived from the
    // current text, and neither is any use if it only updates on submit.
    for (final field in [_password, _confirm, _email, _code]) {
      field.addListener(_rebuild);
    }
    _username.addListener(_mirrorIntoNickname);
    _nickname.addListener(_noticeNicknameEdit);
  }

  @override
  void dispose() {
    for (final field in [
      _username,
      _nickname,
      _password,
      _confirm,
      _email,
      _code,
    ]) {
      field.dispose();
    }
    super.dispose();
  }

  void _rebuild() => setState(() {});

  void _mirrorIntoNickname() {
    if (!_nicknameTouched && _nickname.text != _username.text) {
      _mirroring = true;
      _nickname.value = TextEditingValue(
        text: _username.text,
        selection: TextSelection.collapsed(offset: _username.text.length),
      );
      _mirroring = false;
    }
    setState(() {});
  }

  /// Anything written to the nickname that this class did not write is a hand edit.
  ///
  /// Noticed here rather than in the field's `onChanged`, because the controller's listeners run
  /// FIRST: by the time `onChanged` could set the flag, the mirror has already run and thrown the
  /// edit away.
  void _noticeNicknameEdit() {
    if (!_mirroring) _nicknameTouched = true;
    setState(() {});
  }

  bool get _canSubmit =>
      isValidUsername(_username.text) &&
      _nickname.text.isNotEmpty &&
      isValidPassword(_password.text) &&
      _password.text == _confirm.text &&
      _email.text.isNotEmpty &&
      _code.text.isNotEmpty;

  Future<void> _sendCode() async {
    setState(() {
      _sendingCode = true;
      _error = null;
    });
    try {
      await ref.read(authApiProvider).sendEmailVerifyCode(_email.text.trim());
      if (mounted) setState(() => _codeSent = true);
    } catch (error) {
      // Named rather than swallowed: without a code there is no way forward, and the usual cause
      // (no SMTP configured on this deployment) is something the operator has to be told.
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _sendingCode = false);
    }
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    await ref
        .read(sessionProvider.notifier)
        .register(
          username: _username.text.trim(),
          nickname: _nickname.text.trim(),
          password: _password.text,
          email: _email.text.trim(),
          emailCode: _code.text.trim(),
        );
    if (!mounted) return;
    final session = ref.read(sessionProvider);
    setState(() {
      _busy = false;
      _error = session.hasError ? '${session.error}' : null;
    });
    // On success the router notices the session and moves; this screen does not navigate itself.
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final usernameOk =
        _username.text.isEmpty || isValidUsername(_username.text);
    final match = _confirm.text.isEmpty || _password.text == _confirm.text;

    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerLow,
                border: Border.all(color: scheme.outlineVariant),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('register', style: text.headlineSmall),
                  const SizedBox(height: 24),

                  const _Label('username'),
                  TextField(controller: _username),
                  if (!usernameOk)
                    const _Hint(usernameRule, bad: true)
                  else
                    const SizedBox(height: 16),

                  const _Label('nickname'),
                  TextField(controller: _nickname),
                  const SizedBox(height: 16),

                  const _Label('password'),
                  TextField(controller: _password, obscureText: true),
                  const SizedBox(height: 6),
                  _Rules(checks: PasswordChecks.of(_password.text)),
                  const SizedBox(height: 10),

                  const _Label('confirm password'),
                  TextField(controller: _confirm, obscureText: true),
                  if (!match)
                    const _Hint('the two passwords do not match', bad: true)
                  else
                    const SizedBox(height: 16),

                  const _Label('email'),
                  Row(
                    children: [
                      Expanded(child: TextField(controller: _email)),
                      const SizedBox(width: 8),
                      SizedBox(
                        height: Metrics.composerHeight,
                        child: FilledButton.tonal(
                          onPressed: _email.text.isEmpty || _sendingCode
                              ? null
                              : _sendCode,
                          child: Text(_codeSent ? 'resend' : 'send code'),
                        ),
                      ),
                    ],
                  ),
                  if (_codeSent)
                    const _Hint('a code is on its way to that address')
                  else
                    const SizedBox(height: 16),

                  const _Label('code from the email'),
                  TextField(controller: _code),
                  const SizedBox(height: 16),

                  if (_error != null) ...[
                    Text(_error!, style: TextStyle(color: scheme.error)),
                    const SizedBox(height: 12),
                  ],

                  SizedBox(
                    height: 44,
                    child: FilledButton(
                      onPressed: _busy || !_canSubmit ? null : _submit,
                      child: _busy
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('create account'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Center(
                    child: TextButton(
                      onPressed: widget.onSignIn,
                      child: const Text('have an account? sign in'),
                    ),
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

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
  );
}

class _Hint extends StatelessWidget {
  const _Hint(this.text, {this.bad = false});

  final String text;
  final bool bad;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 12),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: bad ? scheme.error : scheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

/// The password's four rules, ticking off as they are met.
class _Rules extends StatelessWidget {
  const _Rules({required this.checks});

  final PasswordChecks checks;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final rule in checks.rules)
          Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Row(
              children: [
                Icon(
                  rule.met ? Icons.check : Icons.remove,
                  size: 12,
                  color: rule.met ? scheme.primary : scheme.onSurfaceVariant,
                ),
                const SizedBox(width: 6),
                Text(
                  rule.label,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: rule.met ? scheme.primary : scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
