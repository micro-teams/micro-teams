/// What this client is, and how to get another one.
///
/// Two questions live here because they are the same conversation. "Which build am I running?" is
/// what somebody asks before reporting that something is broken — and the answer has to come from
/// the artefact rather than from the server, or it answers about the server. "Where do I get the
/// app?" is the other half: a native client is installed rather than served, so somebody has to
/// carry the address across, and the address it needs is this deployment's own.
///
/// Everything here is copyable. A version you can read but not copy is a version that gets
/// mistyped into a bug report.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../build_info.dart';
import '../clients.dart';
import '../open_link.dart';
import '../../providers.dart';
import 'app_dialog.dart';

/// The line in the profile that opens all this. Quiet on purpose: it is the answer to a question
/// most people never ask.
class ClientInfoLine extends ConsumerWidget {
  const ClientInfoLine({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final build = currentBuild();
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final version = build.version.isEmpty ? 'unstamped' : build.version;

    return InkWell(
      onTap: () => showClientInfo(context),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Icon(Icons.info_outline, size: 16, color: scheme.onSurfaceVariant),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${build.platform} · $version',
                style: text.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ),
            Icon(Icons.chevron_right, size: 16, color: scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}

Future<void> showClientInfo(BuildContext context) =>
    showAppDialog<void>(context, builder: (context) => const _ClientInfo());

class _ClientInfo extends ConsumerWidget {
  const _ClientInfo();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final build = currentBuild();
    final endpoints = ref.watch(endpointsProvider);
    final packages = ref.watch(clientPackagesProvider);

    return AlertDialog(
      title: const Text('this client'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Fact(label: 'version', value: build.version),
              _Fact(label: 'built', value: build.builtAt),
              _Fact(label: 'platform', value: build.platform),
              _Fact(label: 'build', value: build.flavour),
              const Divider(height: 24),
              // The value a native client has to be given, taken from wherever this one is running.
              // On the web that is the page's own address; on a phone it is what was typed at
              // sign-in, which is exactly what somebody setting up a second device needs to copy.
              _Fact(label: 'server', value: endpoints.publicOrigin),
              const Divider(height: 24),
              Text(
                'apps',
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 4),
              ...switch (packages) {
                AsyncData(:final value) when value.isEmpty => [
                  Text(
                    'this deployment ships none yet',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
                AsyncData(:final value) => [
                  for (final client in value)
                    _Download(client: client, origin: endpoints.publicOrigin),
                ],
                _ => [const LinearProgressIndicator(minHeight: 2)],
              },
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('close'),
        ),
      ],
    );
  }
}

/// One fact, with the button that puts it on the clipboard.
class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final shown = value.trim().isEmpty ? '—' : value.trim();
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 72,
            child: Text(
              label,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ),
          Expanded(
            child: SelectableText(
              shown,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          IconButton(
            tooltip: 'copy $label',
            iconSize: 16,
            visualDensity: VisualDensity.compact,
            constraints: const BoxConstraints.tightFor(width: 28, height: 28),
            onPressed: shown == '—'
                ? null
                : () => Clipboard.setData(ClipboardData(text: shown)),
            icon: const Icon(Icons.copy_outlined, size: 16),
          ),
        ],
      ),
    );
  }
}

class _Download extends StatelessWidget {
  const _Download({required this.client, required this.origin});

  final ClientPackage client;
  final String origin;

  @override
  Widget build(BuildContext context) {
    final url = '$origin${client.url}';
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  client.name,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                Text(
                  [
                    client.size,
                    // Said plainly rather than hidden: a debug-signed package cannot be replaced in
                    // place by a properly signed one later, and finding that out at update time is
                    // finding it out too late.
                    if (client.signed == 'debug') 'debug-signed',
                  ].where((part) => part.isNotEmpty).join(' · '),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          // Opening a link is the web's job; where nothing can open one, the address is copyable
          // instead, which is the honest fallback rather than a button that does nothing.
          TextButton(
            onPressed: () {
              if (!openLink(url)) {
                Clipboard.setData(ClipboardData(text: url));
              }
            },
            child: const Text('download'),
          ),
        ],
      ),
    );
  }
}
