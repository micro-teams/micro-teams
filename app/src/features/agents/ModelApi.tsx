/*
 * An agent's model API: which endpoint, model and key its program uses — for the drivers that take
 * one from MicroTeams rather than from the machine (today: dsh).
 *
 * modelApiSummary(llm) — one line for the agent page.
 * <ModelApiFields initial? hasKey? onChange /> — the fields, shared by "open agent" and the agent
 *   page's editor; onChange(settings) reports what they describe, provider "none" meaning the
 *   machine's own configuration.
 * <ModelApiEditor agent done /> — the agent page's dialog body: the fields and "save"; done(settings).
 *
 * The key is write-only: the server never sends it back, so the field starts empty and says
 * whether one is set, and empty keeps it; only "remove the stored key" clears it. The setting
 * reaches the program when it starts, which is why saving is followed by an offer to restart.
 *
 * Example: <ModelApiFields onChange={setLlm} />
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import type { FleetAgent, LlmSettings } from "../../data/agents";
import { Labelled } from "../../ui/Labelled";
import { Select } from "../../ui/Menu";
import { DialogActions } from "../../ui/Dialog";
import { Button, Field, Txt } from "../../ui/kit";
import { colors } from "../../ui/theme";

type Llm = NonNullable<FleetAgent["llm"]>;
type Api = NonNullable<LlmSettings["api"]>;

export function modelApiSummary(llm?: Llm): string {
  if (!llm) return "the machine's own dsh configuration";
  return [llm.provider === "deepseek" ? "DeepSeek" : "custom", llm.api, llm.baseUrl, llm.model, llm.hasApiKey ? "key set" : "no key"].filter(Boolean).join(" · ");
}

export function ModelApiFields({ initial, hasKey, onChange }: { initial?: Llm; hasKey?: boolean; onChange: (s: LlmSettings) => void }) {
  const [provider, setProvider] = useState<LlmSettings["provider"]>(initial?.provider ?? "none");
  const [api, setApi] = useState<Api>((initial?.api as Api | undefined) ?? "openai-completions");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const none = provider === "none";
  const custom = provider === "custom";
  useEffect(() => {
    const text = (v: string) => (v.trim() ? v.trim() : undefined);
    onChange({
      provider,
      api: custom ? api : undefined,
      baseUrl: none ? undefined : text(baseUrl),
      model: none ? undefined : text(model),
      // Empty: keep whatever key is stored. Only the explicit "remove" clears it.
      apiKey: none ? undefined : clearKey ? "" : text(key),
    });
  }, [provider, api, baseUrl, model, key, clearKey, none, custom, onChange]);
  return (
    <View style={styles.fields}>
      <Labelled label="model API">
        <Select
          testID="llm"
          value={provider}
          onChange={setProvider}
          options={[
            { value: "none", label: "the machine's own configuration" },
            { value: "deepseek", label: "DeepSeek" },
            { value: "custom", label: "custom endpoint" },
          ]}
        />
      </Labelled>
      {custom && (
        <Labelled label="protocol">
          <Select
            testID="llm-api"
            value={api}
            onChange={setApi}
            options={[
              { value: "openai-completions", label: "OpenAI Chat Completions" },
              { value: "openai-responses", label: "OpenAI Responses" },
              { value: "anthropic-messages", label: "Anthropic Messages" },
            ]}
          />
        </Labelled>
      )}
      {!none && (
        <>
          <Field value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" keyboardType="url" placeholder={custom ? "base URL — usually ending in /v1" : "base URL — DeepSeek's own API"} />
          <Field value={model} onChangeText={setModel} autoCapitalize="none" placeholder={custom ? "model — required" : "model — dsh's default"} />
          <Field value={key} onChangeText={setKey} secure editable={!clearKey} placeholder={hasKey ? "API key — a key is set; leave empty to keep it" : "API key — not set"} />
          {hasKey && (
            <Pressable onPress={() => setClearKey((c) => !c)} style={styles.check}>
              <MaterialIcons name={clearKey ? "check-box" : "check-box-outline-blank"} size={18} color={clearKey ? colors.brand : colors.inkMuted} />
              <Txt>remove the stored key</Txt>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

export function ModelApiEditor({ agent, done }: { agent: FleetAgent; done: (s: LlmSettings) => void }) {
  const [settings, setSettings] = useState<LlmSettings>({ provider: "none" });
  const invalid = settings.provider === "custom" && (!settings.model || !settings.baseUrl);
  return (
    <>
      <ModelApiFields initial={agent.llm} hasKey={agent.llm?.hasApiKey} onChange={setSettings} />
      <DialogActions>
        <Button kind="text" testID="llm-save" label="save" disabled={invalid} onPress={() => done(settings)} />
      </DialogActions>
    </>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 8 },
  check: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
});
