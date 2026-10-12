/**
 * Mutation catalogue (#111): one entry per guard that must never silently break. Each entry breaks
 * one guard in a copy of the source, and the named test files must then fail. `bun run mutations`
 * (.github/scripts/mutation-check.ts) runs them; the suite itself never reads this file.
 *
 * An entry is a single exact `find` string that occurs exactly once in `file` (repo-relative), and
 * the `replace` text that takes its place. Keep the mutation small and plausible: the kind of edit a
 * refactor makes by mistake. `invariant` cites docs/architecture.md; a number is never reused.
 *
 * An entry is "killed" when the named test files fail after the mutation (and pass before it). A
 * surviving entry is a real gap in the tests: name it in the report, add the test, never delete the
 * entry to make the run green.
 */
export interface Mutation {
  /** Stable id, `I<n>-<what>`. */
  readonly id: string
  /** The invariant it protects, e.g. `I15`. */
  readonly invariant: string
  /** The source file the mutation edits, relative to the repository root. */
  readonly file: string
  /** Exact text, must occur exactly once in `file`. */
  readonly find: string
  /** What replaces it. */
  readonly replace: string
  /** Test files that must fail after the mutation (and pass before it), relative to the root. */
  readonly tests: readonly string[]
}

export const MUTATIONS: readonly Mutation[] = [
  {
    id: "I8-request-session-allows-tools",
    invariant: "I8",
    file: "src/session/seeds.ts",
    find: `{ action: "*", resource: "*", effect: "deny" },`,
    replace: `{ action: "*", resource: "*", effect: "allow" },`,
    tests: ["test/session/caller.test.ts"],
  },
  {
    id: "I15-unknown-route-before-auth",
    invariant: "I15",
    file: "src/openai/route.ts",
    find: "    const auth = authenticate(host.options, gemini ? geminiAuthorization(request, url) : request.headers.authorization)",
    replace: `    if (!gemini && modelId === undefined && !known(route)) return fail(response, { status: 404, kind: "not_found", code: "not_found", message: "No route" })\n    const auth = authenticate(host.options, gemini ? geminiAuthorization(request, url) : request.headers.authorization)`,
    tests: ["test/http/ingress.test.ts", "test/http/observability.test.ts"],
  },
  {
    id: "I16-host-header-not-checked",
    invariant: "I16",
    file: "src/http.ts",
    find: "  if (!hostAllowed(options, request.headers.host))",
    replace: "  if (false && !hostAllowed(options, request.headers.host))",
    tests: ["test/http/ingress.test.ts"],
  },
  {
    id: "I16-keyless-origin-allowed",
    invariant: "I16",
    file: "src/http.ts",
    find: "  if (Object.keys(options.keys).length === 0 && request.headers.origin !== undefined)",
    replace: "  if (false && Object.keys(options.keys).length === 0 && request.headers.origin !== undefined)",
    tests: ["test/http/ingress.test.ts"],
  },
  {
    id: "I18-responses-failure-after-200",
    invariant: "I18",
    file: "src/responses/route.ts",
    find: "    if (!sse.started && !response.headersSent) {",
    replace: "    if (sse.started || response.headersSent) {",
    tests: ["test/http/responses.test.ts"],
  },
  {
    id: "I18-chat-failure-after-200",
    invariant: "I18",
    file: "src/openai/route.ts",
    find: "      if (!sse.started && !response.headersSent) {",
    replace: "      if (sse.started || response.headersSent) {",
    tests: ["test/http/chat.test.ts"],
  },
  {
    id: "I17-remote-image-any-address",
    invariant: "I17",
    file: "src/session/media.ts",
    find: "return nameAllowed || isPublic(ip) ||",
    replace: "return nameAllowed || true ||",
    tests: ["test/session/media.test.ts"],
  },
  {
    id: "I22-request-id-from-client",
    invariant: "I22",
    file: "src/openai/route.ts",
    find: `    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12)`,
    replace: `    const id = (request.headers["x-plugboard-request-id"] as string | undefined) ?? crypto.randomUUID().replaceAll("-", "").slice(0, 12)`,
    tests: ["test/http/observability.test.ts"],
  },
  {
    id: "I19-disconnect-does-not-abort",
    invariant: "I19",
    file: "src/http.ts",
    find: 'if (!response.writableFinished) abort("disconnected")',
    replace: 'if (false) abort("disconnected")',
    tests: ["test/http/chat.test.ts", "test/http/transport.test.ts"],
  },
  {
    id: "I11-session-before-backend-ready",
    invariant: "I11",
    file: "src/session/caller.ts",
    find: "        const unavailable = await ensureBackend?.(app, context.signal)",
    replace: "        const unavailable = (void ensureBackend?.(app, context.signal), undefined) as PlugError | undefined",
    tests: ["test/session/caller.test.ts", "test/runtime/ensure-backend.test.ts"],
  },
  {
    id: "I4-context-hook-active-without-confirmation",
    invariant: "I4",
    file: "src/session/context.ts",
    find: "(options.active() ? applyContext(event, options.sessions, options.apps ?? {}) : undefined)",
    replace: "(applyContext(event, options.sessions, options.apps ?? {}))",
    tests: ["test/session/context.test.ts", "test/runtime/plugin.test.ts"],
  },
  {
    id: "I5-rejected-generation-installs-hooks",
    invariant: "I5",
    file: "index.ts",
    find: "      if (!registration.accepted) return",
    replace: "      if (!registration.accepted && false) return",
    tests: ["test/runtime/plugin.test.ts", "test/runtime/generations.test.ts"],
  },
  {
    id: "I13-provider-text-reaches-caller",
    invariant: "I13",
    file: "src/session/events.ts",
    find: 'message: "The model provider is rate limiting requests; retry later"',
    replace: 'message: error?.message || "The model provider is rate limiting requests; retry later"',
    tests: ["test/session/collector.test.ts"],
  },
  {
    id: "cache-stores-tool-call-turns",
    invariant: "cache",
    file: "src/cache.ts",
    find: "        } else storable = false",
    replace: "        } else storable = true",
    tests: ["test/unit/cache.test.ts", "test/http/cache.test.ts"],
  },
  {
    id: "limits-slot-kept-on-abort",
    invariant: "limits",
    file: "src/limits.ts",
    find: `  signal.addEventListener("abort", free, { once: true })`,
    replace: "  void signal",
    tests: ["test/unit/limits.test.ts"],
  },
  {
    id: "budget-refuses-at-the-ceiling",
    invariant: "budgets",
    file: "src/budgets.ts",
    find: "    if (used >= limit) {",
    replace: "    if (used > limit) {",
    tests: ["test/unit/budgets.test.ts", "test/http/budgets.test.ts"],
  },
  {
    id: "fallback-retries-after-abort",
    invariant: "fallback",
    file: "src/fallback.ts",
    find: "    if (context.signal.aborted) reason = undefined",
    replace: "    if (false) reason = undefined",
    tests: ["test/unit/fallback.test.ts"],
  },
  {
    id: "anthropic-duplicate-tool-names-allowed",
    invariant: "I20",
    file: "src/anthropic/request.ts",
    find: "if (names.has(entry.name)) return bad(",
    replace: "if (false && names.has(entry.name)) return bad(",
    tests: ["test/unit/anthropic-request.test.ts"],
  },
  {
    id: "I2-finalizer-awaits",
    invariant: "I2",
    file: "index.ts",
    find: "yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))",
    replace: "yield* Effect.addFinalizer(() => Effect.promise(async () => { await Promise.resolve(); registration.dispose() }))",
    tests: ["test/runtime/plugin.test.ts"],
  },
  {
    id: "I3-setup-touches-storage",
    invariant: "I3",
    file: "index.ts",
    find: "      // ---- every Location: join the shared listener (sync registration only).",
    replace: '      void ctx.storage.scan("history")\n      // ---- every Location: join the shared listener (sync registration only).',
    tests: ["test/runtime/plugin.test.ts"],
  },
]
