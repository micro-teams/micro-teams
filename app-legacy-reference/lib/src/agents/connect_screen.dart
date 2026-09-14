/// The web end of `microteams link auto-connect`.
///
/// The CLI prints `${origin}/connect?code=…` for a human to open; this page reads that code, lets
/// the signed-in human pick which of their teams the new machine should serve, and approves it.
/// There is no preview endpoint — approving IS the flow — so this page's whole job is: read the
/// code, collect team ids, call, say what happened.
///
/// Without it, a brand new machine cannot join at all from this client: "add a device" can only
/// re-use a machine that is already enrolled.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/team_scope.dart';
import '../providers.dart';
import 'agents_controller.dart';

class ConnectScreen extends ConsumerStatefulWidget {
  const ConnectScreen({required this.code, required this.onDone, super.key});

  /// The one-time code out of the link. Empty when somebody opened /connect by hand.
  final String code;

  /// Where to go once the machine is in — the agents list, which is what it is for.
  final VoidCallback onDone;

  @override
  ConsumerState<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends ConsumerState<ConnectScreen> {
  final Set<int> _picked = {};
  bool _busy = false;
  String? _error;
  Machine? _approved;

  Future<void> _approve() async {
    if (widget.code.isEmpty) {
      setState(
        () => _error =
            'this link has no code — open the exact link the CLI printed',
      );
      return;
    }
    if (_picked.isEmpty) {
      setState(
        () => _error = 'pick at least one team for this machine to serve',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final response = await ref
          .read(mtClientProvider)
          .machine
          .approveEnrollment(
            approveEnrollmentRequest: ApproveEnrollmentRequest(
              code: widget.code,
              teamIds: _picked.toList(),
            ),
          );
      // The fleet has a new member; anything showing it should say so without being asked.
      ref.invalidate(agentsProvider);
      ref.invalidate(allMachinesProvider);
      if (mounted) {
        setState(() {
          _approved = response.data;
          _busy = false;
        });
      }
    } catch (e) {
      // The server's own words: an expired code, a code that was already used, a team you are not
      // in. Rewording them here would only make them vaguer.
      if (mounted) {
        setState(() {
          _error = '$e';
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final teams = ref.watch(teamsProvider).valueOrNull ?? const <Team>[];
    final scheme = Theme.of(context).colorScheme;
    final approved = _approved;

    return Scaffold(
      appBar: AppBar(title: const Text('approve device')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (approved != null) ...[
                const SizedBox(height: 32),
                Icon(Icons.check_circle, size: 48, color: scheme.primary),
                const SizedBox(height: 12),
                Center(
                  child: Text(
                    'machine approved',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                const SizedBox(height: 8),
                Center(
                  child: Text(
                    '${approved.name.isEmpty ? approved.id : approved.name} '
                    'is enrolled, and can serve the '
                    '${_picked.length > 1 ? 'teams' : 'team'} you picked.',
                    textAlign: TextAlign.center,
                  ),
                ),
                const SizedBox(height: 24),
                Center(
                  child: FilledButton(
                    onPressed: widget.onDone,
                    child: const Text('go to agents'),
                  ),
                ),
              ] else ...[
                if (widget.code.isEmpty)
                  _Notice(
                    text:
                        'this link has no code. Open the exact link '
                        '`microteams link auto-connect` printed on the machine.',
                    tone: scheme.error,
                  )
                else
                  const _Notice(
                    text:
                        'A machine is waiting to be enrolled. Pick which teams it '
                        'should serve, then approve it — agents can be opened on it '
                        'after that.',
                  ),
                const SizedBox(height: 16),
                Text('teams', style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 8),
                if (teams.isEmpty)
                  const _Notice(
                    text:
                        'You have no teams yet. Make one first, then come back to '
                        'this link.',
                  )
                else
                  for (final team in teams)
                    CheckboxListTile(
                      value: _picked.contains(team.id),
                      title: Text(team.name),
                      controlAffinity: ListTileControlAffinity.leading,
                      onChanged: (on) => setState(() {
                        if (on ?? false) {
                          _picked.add(team.id);
                        } else {
                          _picked.remove(team.id);
                        }
                      }),
                    ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: TextStyle(color: scheme.error)),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy || teams.isEmpty ? null : _approve,
                  child: _busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('approve this machine'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, this.tone});

  final String text;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: tone ?? scheme.outlineVariant),
      ),
      child: Text(text, style: TextStyle(color: tone)),
    );
  }
}
