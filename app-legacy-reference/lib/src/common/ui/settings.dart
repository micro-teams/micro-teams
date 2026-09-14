/// The settings a client has of its own.
///
/// One, at the time of writing: which server this installation talks to. It is here rather than on
/// the login form because it is not a credential — it is set once, by whoever installs the app, and
/// a third box between "username" and "password" reads as a third thing to type every time.
///
/// A frame on the display stack like every other dialog, so back closes it.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../build_info.dart';
import '../../providers.dart';
import 'app_dialog.dart';

Future<void> showSettings(BuildContext context) =>
    showAppDialog<void>(context, builder: (context) => const _Settings());

class _Settings extends ConsumerStatefulWidget {
  const _Settings();

  @override
  ConsumerState<_Settings> createState() => _SettingsState();
}

class _SettingsState extends ConsumerState<_Settings> {
  late final _server = TextEditingController(
    text: ref.read(serverProvider) ?? defaultServer,
  );
  String? _error;

  @override
  void dispose() {
    _server.dispose();
    super.dispose();
  }

  void _save() {
    final typed = _server.text.trim();
    final uri = Uri.tryParse(typed);
    if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
      setState(() => _error = 'a full address, like $defaultServer');
      return;
    }
    // Saving rebuilds everything that talks to a server — the clients, the line manager, the
    // sockets — because half the app pointing at the previous one is worse than either.
    ref.read(serverProvider.notifier).use(typed);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('settings'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('server', style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 6),
            TextField(
              controller: _server,
              keyboardType: TextInputType.url,
              autocorrect: false,
              onSubmitted: (_) => _save(),
              decoration: InputDecoration(errorText: _error),
            ),
            const SizedBox(height: 8),
            Text(
              'Where this app signs in and syncs. Ask whoever runs your '
              'deployment, or read it from the web app under "me".',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('cancel'),
        ),
        TextButton(onPressed: _save, child: const Text('save')),
      ],
    );
  }
}
