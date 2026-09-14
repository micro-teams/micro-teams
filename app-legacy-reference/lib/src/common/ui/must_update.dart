/// The screen a native client shows when it is a generation behind the deployment.
///
/// Over everything, and there is deliberately no way past it: the reason a client is stopped is
/// that its idea of the protocol no longer matches the server's, and the failures that produces are
/// the confusing kind — a screen that loads and then behaves wrongly, rather than one that says
/// what is wrong. See common/server_version.dart for what "behind" means and, just as importantly,
/// what is NOT treated as behind.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../build_info.dart';
import '../clients.dart';
import '../open_link.dart';
import '../server_version.dart';
import '../../providers.dart';

class MustUpdate extends ConsumerWidget {
  const MustUpdate({required this.deployed, super.key});

  /// What the deployment says it is running.
  final String deployed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final mine = currentBuild();
    final endpoints = ref.watch(endpointsProvider);
    final packages = ref.watch(clientPackagesProvider).valueOrNull ?? const [];
    final android = packages
        .where((client) => client.platform == mine.platform)
        .toList();

    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('a newer app is required', style: text.headlineSmall),
                const SizedBox(height: 12),
                Text(
                  'This app is ${mine.version}; ${endpoints.publicOrigin} is '
                  'running $deployed. They are different generations, and '
                  'carrying on would fail in ways that are hard to read.',
                  style: text.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 20),
                if (android.isEmpty)
                  // Nothing to offer is not nothing to say: the address is what somebody needs in
                  // order to go and find it themselves.
                  Text(
                    'Get the current app from ${endpoints.publicOrigin}',
                    style: text.bodyMedium,
                  )
                else
                  for (final client in android)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: SizedBox(
                        height: 44,
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: () async {
                            final url =
                                '${endpoints.publicOrigin}${client.url}';
                            if (!await openLink(url)) {
                              await Clipboard.setData(ClipboardData(text: url));
                            }
                          },
                          child: Text('download ${client.name}'),
                        ),
                      ),
                    ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () => ref.invalidate(deployedVersionProvider),
                  child: const Text('check again'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
