import { OPS } from '../api/ops'
import type { OpId, OpParams, OpResult, OpSpec } from '../api/ops'

// Small conveniences shared by the CLI applet. The heavy lifting (HTTP, fs, exec) is the host's;
// this only adds typed ergonomics on top of the synchronous `microteams.http` binding.

/**
 * Perform a typed backend call, throwing on any 4xx/5xx so a command's `run` can treat the result
 * as the happy-path value. The response body is trusted to match `T` — build-time type-safety
 * comes from the caller annotating `T` with a generated model from `../api`.
 */
export function request<T>(req: HttpRequest): T {
  const res = microteams.http(req)
  if (res.status >= 400) {
    const detail = typeof res.body === 'string' ? res.body : JSON.stringify(res.body)
    throw new Error(`${req.method} ${req.path} -> ${res.status}: ${detail}`)
  }
  return res.body as T
}

/**
 * Call one backend operation by its operationId, typed end to end by the generated op table
 * (src/api/ops.ts, written by scripts/gen-ops.mjs from MicroTeams-API.yml): `params` must be the
 * generator's request interface for that operation and the result is its response model. A path,
 * parameter or field the contract no longer has is therefore a typecheck error, not a 4xx an agent
 * meets at runtime.
 */
export function call<K extends OpId>(op: K, params: OpParams[K]): OpResult[K] {
  const spec: OpSpec = OPS[op]
  const p = params as unknown as Record<string, unknown>
  const path = spec.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = p[name]
    if (v == null) throw new Error(`${op}: missing path parameter ${name}`)
    return encodeURIComponent(String(v))
  })
  const query: Record<string, string | number | boolean> = {}
  for (const name of spec.queryParams) {
    const v = p[name]
    if (v != null) query[name] = v as string | number | boolean
  }
  if (spec.bodyType != null && spec.bodyType !== 'application/json') {
    // The host JSON-encodes every body, so it cannot send text/plain (writeDocument). Such an
    // operation is not reachable from the CLI: docs are written in the git checkout instead.
    throw new Error(`${op}: the CLI host can only send JSON bodies, not ${spec.bodyType}`)
  }
  const body = spec.bodyKey != null ? p[spec.bodyKey] : undefined
  return request<OpResult[K]>({ method: spec.method, path, query, body })
}
