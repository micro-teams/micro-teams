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
