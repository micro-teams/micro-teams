/// Sign in.
///
/// The only screen that is allowed to exist before there is a session, and the only one that ever
/// shows a password field.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import '../common/build_info.dart';

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

  /// Only ever built on a native client — see the field's own comment in build().
  late final _server = TextEditingController(
    text: ref.read(serverProvider) ?? defaultServer,
  );
  final _form = GlobalKey<FormState>();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    // Before the request, obviously: it decides where the request goes. Saved rather than passed,
    // because everything else in the app reads it from the same place afterwards.
    if (!kIsWeb) ref.read(serverProvider.notifier).use(_server.text);
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
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('login', style: text.headlineSmall),
                    const SizedBox(height: 24),
                    // A native client was installed rather than served, so nothing about it says
                    // which deployment it belongs to. It has to ask, and this is the moment: the
                    // answer decides where the very next request goes. The web never shows this —
                    // the page came from the server, and a page that could be pointed elsewhere
                    // would be a page pointed at a server that never set its cookie.
                    if (!kIsWeb) ...[
                      _Label('server'),
                      TextFormField(
                        controller: _server,
                        keyboardType: TextInputType.url,
                        autocorrect: false,
                        validator: (value) {
                          final uri = Uri.tryParse((value ?? '').trim());
                          if (uri == null ||
                              !uri.hasScheme ||
                              !uri.hasAuthority) {
                            return 'a full address, like $defaultServer';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),
                    ],
                    _Label('username'),
                    TextFormField(
                      controller: _username,
                      autofillHints: const [AutofillHints.username],
                      validator: (value) => (value ?? '').trim().isEmpty
                          ? 'enter your username'
                          : null,
                    ),
                    const SizedBox(height: 16),
                    _Label('password'),
                    TextFormField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      onFieldSubmitted: (_) => _submit(),
                      validator: (value) =>
                          (value ?? '').isEmpty ? 'enter your password' : null,
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
