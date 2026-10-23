/// An agent's model API: which endpoint, model and key its program uses — for drivers that take
/// one from MicroTeams rather than from the machine (today: dsh, DeepSeek Harness).
///
/// The key is write-only. The server never sends it back, so the field starts empty and says
/// whether a key is already set; leaving it empty keeps that key. The setting reaches the program
/// when it starts, so saving offers to restart the agent rather than pretending it applied.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/ui/app_dialog.dart';
import 'agents_controller.dart';

/// One line saying what the agent uses, for the agent page.
String modelApiSummary(AgentLlm? llm) {
  if (llm == null) return "the machine's own dsh configuration";
  final parts = <String>[
    llm.provider == AgentLlmProviderEnum.deepseek ? 'DeepSeek' : 'custom',
    if (llm.api != null) llm.api!,
    if (llm.baseUrl != null) llm.baseUrl!,
    if (llm.model != null) llm.model!,
    llm.hasApiKey ? 'key set' : 'no key',
  ];
  return parts.join(' · ');
}

/// The form fields, shared by the open-agent dialog and the agent page's editor. It reports the
/// setting it describes through [onChanged]; null means "nothing set" (the machine's own config).
class ModelApiFields extends StatefulWidget {
  const ModelApiFields({
    required this.onChanged,
    this.initial,
    this.hasKey = false,
    super.key,
  });

  final AgentLlm? initial;
  final bool hasKey;
  final ValueChanged<AgentLlmSettings?> onChanged;

  @override
  State<ModelApiFields> createState() => _ModelApiFieldsState();
}

class _ModelApiFieldsState extends State<ModelApiFields> {
  late AgentLlmSettingsProviderEnum _provider =
      switch (widget.initial?.provider) {
        AgentLlmProviderEnum.deepseek => AgentLlmSettingsProviderEnum.deepseek,
        AgentLlmProviderEnum.custom => AgentLlmSettingsProviderEnum.custom,
        _ => AgentLlmSettingsProviderEnum.none,
      };
  late AgentLlmSettingsApiEnum _api = AgentLlmSettingsApiEnum.values.firstWhere(
    (a) => a.value == widget.initial?.api,
    orElse: () => AgentLlmSettingsApiEnum.openaiCompletions,
  );
  late final _baseUrl = TextEditingController(
    text: widget.initial?.baseUrl ?? '',
  );
  late final _model = TextEditingController(text: widget.initial?.model ?? '');
  final _key = TextEditingController();
  bool _clearKey = false;

  @override
  void initState() {
    super.initState();
    for (final c in [_baseUrl, _model, _key]) {
      c.addListener(_report);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _report());
  }

  @override
  void dispose() {
    _baseUrl.dispose();
    _model.dispose();
    _key.dispose();
    super.dispose();
  }

  void _report() {
    final none = _provider == AgentLlmSettingsProviderEnum.none;
    final custom = _provider == AgentLlmSettingsProviderEnum.custom;
    String? text(TextEditingController c) =>
        c.text.trim().isEmpty ? null : c.text.trim();
    widget.onChanged(
      AgentLlmSettings(
        provider: _provider,
        api: custom ? _api : null,
        baseUrl: none ? null : text(_baseUrl),
        model: none ? null : text(_model),
        // Empty field: keep whatever key is stored. Only an explicit "remove" clears it.
        apiKey: none ? null : (_clearKey ? '' : text(_key)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final custom = _provider == AgentLlmSettingsProviderEnum.custom;
    final none = _provider == AgentLlmSettingsProviderEnum.none;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DropdownButtonFormField<AgentLlmSettingsProviderEnum>(
          initialValue: _provider,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Model API'),
          items: const [
            DropdownMenuItem(
              value: AgentLlmSettingsProviderEnum.none,
              child: Text("The machine's own configuration"),
            ),
            DropdownMenuItem(
              value: AgentLlmSettingsProviderEnum.deepseek,
              child: Text('DeepSeek'),
            ),
            DropdownMenuItem(
              value: AgentLlmSettingsProviderEnum.custom,
              child: Text('Custom endpoint'),
            ),
          ],
          onChanged: (p) {
            setState(() => _provider = p ?? AgentLlmSettingsProviderEnum.none);
            _report();
          },
        ),
        if (custom) ...[
          const SizedBox(height: 12),
          DropdownButtonFormField<AgentLlmSettingsApiEnum>(
            initialValue: _api,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Protocol'),
            items: const [
              DropdownMenuItem(
                value: AgentLlmSettingsApiEnum.openaiCompletions,
                child: Text('OpenAI Chat Completions'),
              ),
              DropdownMenuItem(
                value: AgentLlmSettingsApiEnum.openaiResponses,
                child: Text('OpenAI Responses'),
              ),
              DropdownMenuItem(
                value: AgentLlmSettingsApiEnum.anthropicMessages,
                child: Text('Anthropic Messages'),
              ),
            ],
            onChanged: (a) {
              setState(
                () => _api = a ?? AgentLlmSettingsApiEnum.openaiCompletions,
              );
              _report();
            },
          ),
        ],
        if (!none) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _baseUrl,
            keyboardType: TextInputType.url,
            decoration: InputDecoration(
              labelText: 'Base URL',
              hintText: custom
                  ? 'the endpoint, usually ending in /v1'
                  : "DeepSeek's own API",
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _model,
            decoration: InputDecoration(
              labelText: 'Model',
              hintText: custom ? 'required' : "dsh's default",
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _key,
            obscureText: true,
            enableSuggestions: false,
            autocorrect: false,
            enabled: !_clearKey,
            decoration: InputDecoration(
              labelText: 'API key',
              hintText: widget.hasKey
                  ? 'a key is set — leave empty to keep it'
                  : 'not set',
            ),
          ),
          if (widget.hasKey)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _clearKey,
              title: const Text('Remove the stored key'),
              onChanged: (v) {
                setState(() => _clearKey = v ?? false);
                _report();
              },
            ),
        ],
      ],
    );
  }
}

/// The agent page's editor. Saves, then offers the restart that makes the setting take effect.
Future<void> showModelApiDialog(BuildContext context, Agent agent) =>
    showAppDialog<void>(
      context,
      builder: (context) => _ModelApiDialog(agent: agent),
    );

class _ModelApiDialog extends ConsumerStatefulWidget {
  const _ModelApiDialog({required this.agent});

  final Agent agent;

  @override
  ConsumerState<_ModelApiDialog> createState() => _ModelApiDialogState();
}

class _ModelApiDialogState extends ConsumerState<_ModelApiDialog> {
  AgentLlmSettings? _settings;
  bool _busy = false;
  String? _error;

  Future<void> _save() async {
    final settings = _settings;
    if (settings == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(agentsProvider.notifier).setLlm(widget.agent, settings);
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      final notifier = ref.read(agentsProvider.notifier);
      Navigator.pop(context);
      messenger.showSnackBar(
        SnackBar(
          content: const Text('Saved. It applies when the agent restarts.'),
          action: SnackBarAction(
            label: 'restart now',
            onPressed: () => notifier.reboot(widget.agent),
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '$e';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Model API'),
      content: SizedBox(
        width: 380,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ModelApiFields(
                initial: widget.agent.llm,
                hasKey: widget.agent.llm?.hasApiKey ?? false,
                onChanged: (s) => _settings = s,
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: const Text('Save'),
        ),
      ],
    );
  }
}
