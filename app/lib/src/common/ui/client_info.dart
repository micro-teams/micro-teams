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

  /// Everything about this client, as the block somebody pastes into a bug report.
  ///
  /// One block with one button, rather than a copy button per line. What has to be handed over is
  /// all of it — a version with no platform beside it is half an answer — and a button per line
  /// made the reader choose which halves to send.
  String _report(BuildInfo build, String server) => [
    'version  ${_or(build.version)}',
    'built    ${_or(build.builtAt)}',
    'platform ${build.platform} (${build.flavour})',
    'server   ${_or(server)}',
  ].join('\n');

  static String _or(String value) => value.trim().isEmpty ? '—' : value.trim();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final build = currentBuild();
    final endpoints = ref.watch(endpointsProvider);
    final packages = ref.watch(clientPackagesProvider);
    final scheme = Theme.of(context).colorScheme;
    final report = _report(build, endpoints.publicOrigin);

    return AlertDialog(
      title: const Text('this client'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  border: Border.all(color: scheme.outlineVariant),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: SelectableText(
                  report,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(height: 1.6),
                ),
              ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () =>
                      Clipboard.setData(ClipboardData(text: report)),
                  icon: const Icon(Icons.copy_outlined, size: 16),
                  label: const Text('copy'),
                ),
              ),
              const Divider(height: 24),
              Text(
                'apps',
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
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
            onPressed: () async {
              if (!await openLink(url)) {
                await Clipboard.setData(ClipboardData(text: url));
              }
            },
            child: const Text('download'),
          ),
        ],
      ),
    );
  }
}
