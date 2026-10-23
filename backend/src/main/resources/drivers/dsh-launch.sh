# The dsh driver's launch script (see DshDriver.kt). Runs as `bash -lc <this> dsh-launch <session>`
# in the agent's working directory, with MICROTEAMS_OPERATOR_PROMPT and, when the agent has a model
# API setting, MICROTEAMS_LLM_* in the environment (AgentLlmService.screenEnv).
#
# dsh has no TUI, so the screen runs `microteams acp-screen`, which speaks ACP to `dsh --profile acp`
# and paints a transcript. What this script adds is the agent's own model API:
#   deepseek  DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL — dsh reads the launch environment before its
#             saved credentials, so a per-agent key wins over anything stored on the machine
#   custom    a config overlay (--patch) declaring one provider, "microteams", whose key dsh reads
#             from MICROTEAMS_LLM_API_KEY; the key itself is never written to disk
# and acp-screen --model selects the model over ACP once the session is open.
_mtsid="$1"
set --
case "${MICROTEAMS_LLM_PROVIDER:-}" in
deepseek)
  if [ -n "${MICROTEAMS_LLM_API_KEY:-}" ]; then export DEEPSEEK_API_KEY="$MICROTEAMS_LLM_API_KEY"; fi
  if [ -n "${MICROTEAMS_LLM_BASE_URL:-}" ]; then export DEEPSEEK_BASE_URL="$MICROTEAMS_LLM_BASE_URL"; fi
  ;;
custom)
  # A YAML double-quoted scalar: backslashes and quotes escaped, so no value can break the file.
  _mtq() { local v="${1//\\/\\\\}"; v="${v//\"/\\\"}"; printf '"%s"' "$v"; }
  _mtp="${XDG_STATE_HOME:-$HOME/.local/state}/microteams/acp/$_mtsid.dsh-patch.yml"
  mkdir -p "$(dirname "$_mtp")"
  umask 077
  {
    echo "- id: llm-pi-ai"
    echo "  config:"
    echo "    providers:"
    echo "      microteams:"
    echo "        apiKeyEnv: MICROTEAMS_LLM_API_KEY"
    echo "        api: $(_mtq "${MICROTEAMS_LLM_API:-}")"
    echo "        baseURL: $(_mtq "${MICROTEAMS_LLM_BASE_URL:-}")"
    echo "        models:"
    echo "          - id: $(_mtq "${MICROTEAMS_LLM_MODEL:-}")"
  } >"$_mtp"
  set -- --patch "$_mtp"
  ;;
esac
# Find DeepSeek Harness. The name `dsh` is not unique: Debian and Arch both ship an unrelated
# "Distributed Shell" as `dsh`, and with that first on PATH the agent dies with an EOF nobody can
# read. Harness answers `--version` with a bare version number; anything else is not it.
_mtdsh=""
for _mtc in "${MICROTEAMS_DSH:-}" "$(npm prefix -g 2>/dev/null)/bin/dsh" "$(command -v dsh 2>/dev/null)"; do
  [ -n "$_mtc" ] && [ -x "$_mtc" ] || continue
  if "$_mtc" --version 2>/dev/null | head -n 1 | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+'; then
    _mtdsh="$_mtc"
    break
  fi
done
if [ -z "$_mtdsh" ]; then
  echo "DeepSeek Harness (dsh) is not installed on this machine."
  if _mto="$(command -v dsh 2>/dev/null)"; then
    echo "The dsh on PATH ($_mto) is a different program: $("$_mto" --version 2>&1 | head -n 1)"
  fi
  echo "Install it with: npm i -g @deepseek-ai/dsh   (or set MICROTEAMS_DSH to its path)"
  exit 127
fi
exec microteams acp-screen --session "$_mtsid" ${MICROTEAMS_LLM_MODEL:+--model "$MICROTEAMS_LLM_MODEL"} -- "$_mtdsh" --profile acp "$@"
