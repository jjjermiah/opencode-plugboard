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
    id: "I29-anchor-shared-across-apps",
    invariant: "I29",
    file: "src/session/affinity.ts",
    find: "const id = recordKey(app, scope, key)",
    replace: 'const id = recordKey("shared", scope, key)',
    tests: ["test/session/affinity.test.ts"],
  },
  {
    id: "I8-server-tools-reject-subagent",
    invariant: "I8",
    file: "src/config.ts",
    find: "if (SESSION_SPAWNING_TOOLS.has(tool))",
    replace: "if (false)",
    tests: ["test/unit/config.test.ts"],
  },
  {
    id: "I25-admin-mints-key-for-server-tools-app",
    invariant: "I25",
    file: "src/admin/route.ts",
    find: "if (appPolicy(host.options, app)?.serverTools)",
    replace: "if (false)",
    tests: ["test/http/admin.test.ts"],
  },
  {
    id: "I9-tools-off-drops-structured-tool",
    invariant: "I9",
    file: "src/session/caller.ts",
    find: "if (structured === undefined || kept.length === 0) {",
    replace: "if (true) {",
    tests: ["test/session/policy.test.ts"],
  },
  {
    id: "I9-server-tool-calls-cap-off",
    invariant: "I9",
    file: "src/session/events.ts",
    find: "if (this.serverCalls.size > (this.hooks.maxServerToolCalls ?? 0))",
    replace: "if (false)",
    tests: ["test/session/server-tools.test.ts"],
  },
  {
    id: "I12-late-server-call-not-stopped",
    invariant: "I12",
    file: "src/session/events.ts",
    find: "if (this.finished && late > 0 && !this.executionDone) this.hooks.stopTurn()",
    replace: "if (false) this.hooks.stopTurn()",
    tests: ["test/session/server-tools.test.ts"],
  },
  {
    id: "I8-server-tool-no-rule-allowed",
    invariant: "I8",
    file: "src/session/seeds.ts",
    find: "      { action: tool, resource: \"*\", effect: \"deny\" as const },",
    replace: "      { action: tool, resource: \"*\", effect: \"allow\" as const },",
    tests: ["test/session/server-tools.test.ts"],
  },
  {
    id: "I8-server-tool-ask-as-allow",
    invariant: "I8",
    file: "src/session/seeds.ts",
    find: "effect: rule.effect === \"allow\" ? (\"allow\" as const) : (\"deny\" as const)",
    replace: "effect: rule.effect !== \"deny\" ? (\"allow\" as const) : (\"deny\" as const)",
    tests: ["test/session/server-tools.test.ts"],
  },
  {
    id: "I24-metrics-app-key-reads-all-apps",
    invariant: "I24",
    file: "src/openai/route.ts",
    find: 'if (!who.admin) return fail(response, { status: 403, kind: "permission", code: "admin_key_required"',
    replace: 'if (false) return fail(response, { status: 403, kind: "permission", code: "admin_key_required"',
    tests: ["test/http/observability.test.ts"],
  },
  {
    id: "I27-session-link-unencoded",
    invariant: "I27",
    file: "src/session/link.ts",
    find: 'return template.replaceAll("{id}", encodeURIComponent(recordID)).replaceAll("{directory}", encodeURIComponent(directory))',
    replace: 'return template.replaceAll("{id}", recordID).replaceAll("{directory}", encodeURIComponent(directory))',
    tests: ["test/unit/session-link.test.ts"],
  },
  {
    id: "I26-user-cap-off-by-one",
    invariant: "I26",
    file: "src/usage.ts",
    find: "const key = distinct < USERS_PER_DAY ? user : OTHER_USER",
    replace: "const key = distinct <= USERS_PER_DAY ? user : OTHER_USER",
    tests: ["test/unit/end-user.test.ts"],
  },
  {
    id: "I26-end-user-unsanitized",
    invariant: "I26",
    file: "src/user.ts",
    find: "return END_USER.test(trimmed) ? trimmed : undefined",
    replace: "return trimmed.length > 0 ? trimmed : undefined",
    tests: ["test/unit/end-user.test.ts"],
  },
  {
    id: "I25-app-key-reads-admin-routes",
    invariant: "I25",
    file: "src/admin/route.ts",
    find: "  if (isPlugError(who) || !who.admin) return fail(",
    replace: "  if (isPlugError(who)) return fail(",
    tests: ["test/http/admin.test.ts"],
  },
  {
    id: "I25-runtime-key-stored-in-clear",
    invariant: "I25",
    file: "src/keys.ts",
    find: "await storage.put(PREFIX + id, JSON.stringify({ app, digest: digest.toString(\"hex\"), createdAt }))",
    replace: "await storage.put(PREFIX + id, JSON.stringify({ app, digest: digest.toString(\"hex\"), createdAt, key }))",
    tests: ["test/unit/keys.test.ts"],
  },
  {
    id: "I8-request-session-allows-tools",
    invariant: "I8",
    file: "src/session/seeds.ts",
    find: `{ action: "*", resource: "*", effect: "deny" },`,
    replace: `{ action: "*", resource: "*", effect: "allow" },`,
    tests: ["test/session/caller.test.ts"],
  },
  {
    id: "I8-untrusted-app-gets-server-tools",
    invariant: "I8",
    file: "src/session/caller.ts",
    find: "          permissions: requestPermissions(policy?.serverTools ?? [], operatorRules),",
    replace: `          permissions: requestPermissions(policy?.serverTools ?? ["websearch"], operatorRules),`,
    tests: ["test/session/server-tools.test.ts"],
  },
  {
    id: "I15-unknown-route-before-auth",
    invariant: "I15",
    file: "src/openai/route.ts",
    find: "    const auth = authenticate(liveOptions(host.options), googleShaped ? geminiAuthorization(request, url) : request.headers.authorization, await runtimeDigests())",
    replace: `    if (!googleShaped && modelId === undefined && !known(route)) return fail(response, { status: 404, kind: "not_found", code: "not_found", message: "No route" })\n    const auth = authenticate(liveOptions(host.options), googleShaped ? geminiAuthorization(request, url) : request.headers.authorization, await runtimeDigests())`,
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
    id: "I28-body-budget-admits-everything",
    invariant: "I25",
    file: "src/http.ts",
    find: "      if (budget.inFlight + bytes > limits.maxBytesInFlight) return false",
    replace: "      if (false) return false",
    tests: ["test/http/transport.test.ts", "test/http/ingress.test.ts"],
  },
  {
    id: "I28-body-budget-never-released",
    invariant: "I25",
    file: "src/http.ts",
    find: "      budget.inFlight -= held",
    replace: "      budget.inFlight -= 0",
    tests: ["test/http/transport.test.ts"],
  },
  {
    id: "I28-read-timeout-never-fires",
    invariant: "I25",
    file: "src/http.ts",
    find: "      limits.readTimeoutMs,\n    )",
    replace: "      limits.readTimeoutMs * 100_000,\n    )",
    tests: ["test/http/transport.test.ts", "test/http/ingress.test.ts"],
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
    id: "I5-revoked-last-key-goes-keyless",
    invariant: "I5",
    file: "src/runtime.ts",
    find: "rt.keys = REVOKED_KEYS",
    replace: "rt.keys = keys",
    tests: ["test/runtime/key-revocation.test.ts"],
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
    find: '  if (type === "provider.rate-limit" || status === 429) {\n    return { status: 429, kind: "rate_limit", code: "rate_limited", message: "The model provider is rate limiting requests; retry later" }',
    replace: '  if (type === "provider.rate-limit" || status === 429) {\n    return { status: 429, kind: "rate_limit", code: "rate_limited", message: error?.message || "The model provider is rate limiting requests; retry later" }',
    tests: ["test/session/collector.test.ts"],
  },
  {
    id: "I8-agent-session-keeps-deny-all",
    invariant: "I8",
    file: "src/session/caller.ts",
    find: "          permissions: requestPermissions(policy?.serverTools ?? [], operatorRules),",
    replace: "          permissions: [],",
    tests: ["test/session/persona.test.ts"],
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
