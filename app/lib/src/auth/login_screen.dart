/// Sign in.
///
/// The only screen that is allowed to exist before there is a session, and the only one that ever
/// shows a password field.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import '../common/ui/settings.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({this.onRegister, super.key});

  /// Where "no account? register" goes. Absent in tests that pump this screen alone.
  final VoidCallback? onRegister;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    await ref
        .read(sessionProvider.notifier)
        .login(_username.text.trim(), _password.text);
    if (!mounted) return;
    final session = ref.read(sessionProvider);
    setState(() {
      _busy = false;
      _error = session.hasError ? '${session.error}' : null;
    });
    // Tell the platform the sign-in is over, which is what makes Android offer to save the
    // password. Without it the fields are recognised and filled but never OFFERED for saving: the
    // system waits for a "context" to be committed and, in a single-page app that never navigates
    // away, nothing ever commits it.
    if (session.hasValue && session.value != null) {
      TextInput.finishAutofillContext();
    }
    // On success the router notices the session and moves; this screen does not navigate itself.
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    // The React login was a bordered card with the heading and the field labels ABOVE their
    // boxes, all lowercase. Material's floating label is a different control with a different
    // rhythm, so the labels here are plain text — matching the old screen rather than the
    // framework's default.
    return Scaffold(
      // Top-right, over the card rather than inside it. Where the server is pointed is a property
      // of this installation, not a field of this form: it is set once, by whoever installs the
      // app, and asking for it in the middle of "username, password" makes it look like a third
      // credential. The web never shows it — the page came from the server.
      appBar: kIsWeb
          ? null
          : AppBar(
              backgroundColor: Colors.transparent,
              actions: [
                IconButton(
                  tooltip: 'settings',
                  onPressed: () => showSettings(context),
                  icon: const Icon(Icons.settings_outlined, size: 20),
                ),
              ],
            ),
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
              child: Form(
                key: _form,
                // The group is what makes a password manager see these two as one login rather
                // than as two unrelated boxes — the hints alone are not enough on Android.
                child: AutofillGroup(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('login', style: text.headlineSmall),
                      const SizedBox(height: 24),
                      _Label('username'),
                      TextFormField(
                        key: const Key('login-username'),
                        controller: _username,
                        autofillHints: const [AutofillHints.username],
                        validator: (value) => (value ?? '').trim().isEmpty
                            ? 'enter your username'
                            : null,
                      ),
                      const SizedBox(height: 16),
                      _Label('password'),
                      TextFormField(
                        key: const Key('login-password'),
                        controller: _password,
                        obscureText: true,
                        autofillHints: const [AutofillHints.password],
                        onFieldSubmitted: (_) => _submit(),
                        validator: (value) => (value ?? '').isEmpty
                            ? 'enter your password'
                            : null,
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        Text(_error!, style: TextStyle(color: scheme.error)),
                      ],
                      const SizedBox(height: 20),
                      SizedBox(
                        height: 44,
                        child: FilledButton(
                          onPressed: _busy ? null : _submit,
                          child: _busy
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Text('sign in'),
                        ),
                      ),
                      if (widget.onRegister != null)
                        Center(
                          child: TextButton(
                            onPressed: widget.onRegister,
                            child: const Text('no account? register'),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A field's name, above its box. See the note in [_LoginScreenState.build].
class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
    );
  }
}
