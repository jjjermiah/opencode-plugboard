/**
 * #73 discovery pages and `/plugboard/status` (src/discovery.ts): pure builders. The disclosure rule is
 * the point: keyless shows everything, keyed without credentials shows only the address and the
 * endpoints, a valid key adds its own app and the configuration, and no key ever appears.
 */
import { describe, expect, test } from "bun:test"
import { buildDiscovery, buildStatus, renderDiscoveryHtml } from "../../src/discovery.js"
import { CATALOG, model, testOptions } from "../support/fixtures.js"

const keyed = testOptions({ keys: { alpha: "key-alpha-secret", beta: "key-beta-secret" }, aliases: { fast: "test/echo#low" } })
const keyless = testOptions({ listen: { port: 4111 }, aliases: { fast: "test/echo#low" } })
const json = (value: unknown) => JSON.stringify(value)

describe("#73 buildDiscovery: what each caller may see", () => {
  test("keyless (loopback only): everything, as the app default", () => {
    const doc = buildDiscovery({ options: keyless, app: "default", catalog: CATALOG })
    expect(doc).toMatchObject({
      name: "opencode-plugboard",
      baseUrl: "http://127.0.0.1:4111/v1",
      authentication: { required: false },
      apps: ["default"],
      models: { state: "ready", allowlist: ["test/*"], aliases: { fast: "test/echo#low" }, available: 5 },
      suggestedModels: ["other/*", "test/*"],
      catalog: {
        providers: [
          { id: "other", models: 1, examples: ["other/model"] },
          { id: "test", models: 2, examples: ["test/echo", "test/vision"] },
        ],
      },
    })
    expect(doc).not.toHaveProperty("hint")
  })

  test("keyed without credentials: address, auth requirement, endpoints and a curl; no apps, allowlist, aliases or catalog", () => {
    const doc = buildDiscovery({ options: keyed, catalog: CATALOG })
    expect(Object.keys(doc).sort()).toEqual(["authentication", "baseUrl", "endpoints", "example", "hint", "listen", "name"])
    expect(doc.authentication).toEqual({ required: true, scheme: "Bearer" })
    // `(?<!v1)beta`: the Gemini endpoints are `/v1beta/...`, which is a path, not an app name (#136).
    expect(json(doc)).not.toMatch(/alpha|(?<!v1)beta|test\/\*|fast/)
  })

  test("keyed with a valid key: its own app and the configuration, never another app", () => {
    const doc = buildDiscovery({ options: keyed, app: "alpha", catalog: CATALOG })
    expect(doc.apps).toEqual(["alpha"])
    expect(doc.models?.allowlist).toEqual(["test/*"])
    expect(json(doc)).not.toMatch(/(?<!v1)beta/)
  })

  test("no key value ever appears, for any caller", () => {
    for (const app of [undefined, "alpha", "beta"]) {
      const doc = buildDiscovery({ options: keyed, app, catalog: CATALOG })
      expect(json(doc) + renderDiscoveryHtml(doc)).not.toContain("secret")
    }
  })

  test("the curl example asks for a key only when one is needed, and uses the first available model", () => {
    expect(buildDiscovery({ options: keyed, app: "alpha", catalog: CATALOG }).example.curl).toContain('-H "Authorization: Bearer $PLUGBOARD_KEY"')
    expect(buildDiscovery({ options: keyless, catalog: CATALOG }).example.curl).not.toContain("Authorization")
    expect(buildDiscovery({ options: keyless, catalog: CATALOG }).example.curl).toContain(`'{"model":"test/echo"`)
  })

  test("/plugboard/metrics is listed only when enabled", () => {
    const paths = (options = keyless) => buildDiscovery({ options }).endpoints.map((endpoint) => endpoint.path)
    expect(paths()).not.toContain("/plugboard/metrics")
    expect(paths(testOptions({ metrics: true }))).toContain("/plugboard/metrics")
  })

  test("an IPv6 listen address is bracketed in the base URL", () => {
    expect(buildDiscovery({ options: testOptions({ listen: { host: "::1", port: 9 } }) }).baseUrl).toBe("http://[::1]:9/v1")
  })

  test("#543 the endpoint list has the stored-response and Files routes, and Responses is not called stateless", () => {
    const doc = buildDiscovery({ options: keyless })
    const listed = doc.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    expect(listed).toEqual(
      expect.arrayContaining([
        "GET /v1/responses/{id}",
        "DELETE /v1/responses/{id}",
        "GET /v1/responses/{id}/input_items",
        "POST /v1/files",
        "GET /v1/files",
        "GET /v1/files/{id}",
        "GET /v1/files/{id}/content",
        "DELETE /v1/files/{id}",
        "POST /upload/v1beta/files",
        "GET /v1beta/files",
        "GET /v1beta/files/{name}",
        "DELETE /v1beta/files/{name}",
      ]),
    )
    expect(json(doc.endpoints)).not.toMatch(/stateless/i)
    expect(renderDiscoveryHtml(doc)).not.toMatch(/stateless/i)
  })
})

describe("#544 the base URL on a wildcard listen address", () => {
  const wildcard = (host: string) => testOptions({ listen: { host, port: 4010 }, keys: { alpha: "key-alpha-secret" } })

  test.each(["0.0.0.0", "::"])("%s: the Host the caller used is the base URL and the curl's address", (host) => {
    const doc = buildDiscovery({ options: wildcard(host), requestHost: "192.0.2.10:4010" })
    expect(doc.baseUrl).toBe("http://192.0.2.10:4010/v1")
    expect(doc.example.curl).toContain("curl -s http://192.0.2.10:4010/v1/chat/completions")
    expect(doc).not.toHaveProperty("baseUrlHint")
    expect(doc.baseUrl + doc.example.curl).not.toContain("0.0.0.0")
  })

  test("a Host without a port, a name and a bracketed IPv6 literal are used as sent", () => {
    expect(buildDiscovery({ options: wildcard("0.0.0.0"), requestHost: "opencode.example" }).baseUrl).toBe("http://opencode.example/v1")
    expect(buildDiscovery({ options: wildcard("0.0.0.0"), requestHost: "[2001:db8::1]:4010" }).baseUrl).toBe("http://[2001:db8::1]:4010/v1")
  })

  test.each([undefined, "", "0.0.0.0:4010", "[::]:4010", "x y", "evil.example/'; rm -rf ~; '", "a<b>:4010", "$(id)"])(
    "no usable Host (%p): a placeholder with the listen port, and a hint on the page and in the JSON",
    (requestHost) => {
      const doc = buildDiscovery({ options: wildcard("0.0.0.0"), requestHost })
      expect(doc.baseUrl).toBe("http://<this-host>:4010/v1")
      expect(doc.example.curl).toContain("http://<this-host>:4010/v1/chat/completions")
      expect(doc.baseUrlHint).toContain("`<this-host>`")
      const html = renderDiscoveryHtml(doc)
      expect(html).toContain("&lt;this-host&gt;:4010/v1")
      expect(html).toContain('<p class="hint">The server listens on every address')
      expect(json(doc)).not.toContain("rm -rf")
    },
  )

  test("the public origin a trusted proxy names wins over the Host header", () => {
    const doc = buildDiscovery({ options: wildcard("0.0.0.0"), publicOrigin: "https://llm.example", requestHost: "192.0.2.10:4010" })
    expect(doc.baseUrl).toBe("https://llm.example/v1")
    expect(doc).not.toHaveProperty("baseUrlHint")
  })

  test("a specific listen address ignores the Host header", () => {
    const doc = buildDiscovery({ options: testOptions({ listen: { host: "192.0.2.10", port: 4010 }, keys: { alpha: "key-alpha-secret" } }), requestHost: "other.example:4010" })
    expect(doc.baseUrl).toBe("http://192.0.2.10:4010/v1")
  })

  test("a Host header on a loopback listener changes nothing", () => {
    expect(buildDiscovery({ options: keyless, requestHost: "localhost:4111" }).baseUrl).toBe("http://127.0.0.1:4111/v1")
  })
})

describe("#73 buildDiscovery: the models state explains a 403 before it happens", () => {
  test.each([
    ["no_models_configured", testOptions({ models: [] }), CATALOG, /`models` option is empty.*"models":\["other\/\*","test\/\*"\]/],
    ["catalog_unavailable", testOptions(), undefined, /could not be loaded/],
    ["none_available", testOptions({ models: ["ghost/*"] }), CATALOG, /Nothing in the `models` allowlist matches/],
  ] as const)("%s", (state, options, catalog, hint) => {
    const doc = buildDiscovery({ options, app: "default", catalog })
    expect(doc.models?.state).toBe(state)
    expect(doc.models?.hint).toMatch(hint)
  })

  test("the empty-models hint and the page suggest `all` first", () => {
    const doc = buildDiscovery({ options: testOptions({ models: [] }), app: "default", catalog: CATALOG })
    expect(doc.models?.hint).toContain('{"models":"all"}')
    expect(renderDiscoveryHtml(doc)).toContain("&quot;models&quot;: &quot;all&quot;")
    expect(buildDiscovery({ options: testOptions({ models: [] }), app: "default" }).models?.hint).toContain('{"models":"all"}')
  })

  test("all with an empty catalog says no provider is connected, not that the allowlist mismatches", () => {
    const doc = buildDiscovery({ options: testOptions({ models: "all" }), app: "default", catalog: [] })
    expect(doc.models).toMatchObject({ state: "none_available", allowlist: ["all"], hint: expect.stringContaining("Connect a provider") })
  })

  test("more than 50 providers are counted, not listed", () => {
    const catalog = Array.from({ length: 53 }, (_, index) => model(`p${String(index).padStart(2, "0")}`, "m"))
    const doc = buildDiscovery({ options: keyless, catalog })
    expect(doc.catalog?.providers).toHaveLength(50)
    expect(doc.catalog?.moreProviders).toBe(3)
  })
})

describe("#73 renderDiscoveryHtml", () => {
  test("every dynamic value is escaped", () => {
    const hostile = '<script>alert("x")</script>'
    const doc = buildDiscovery({ options: testOptions({ models: [`evil/${"x"}`], aliases: { "a<b>": "evil/x" } }), app: "default", catalog: [model("evil", hostile)] })
    const html = renderDiscoveryHtml(doc)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
    expect(html).toContain("a&lt;b&gt; -&gt; evil/x")
  })

  test("has no scripts or external assets and links its JSON twin", () => {
    const html = renderDiscoveryHtml(buildDiscovery({ options: keyless, catalog: CATALOG }))
    expect(html).not.toMatch(/<script|<img|<link|src=|https?:\/\/(?!127\.0\.0\.1)/)
    expect(html).toContain('<a href="/v1">')
  })

  test("the keyed page without credentials shows the hint and no configuration sections", () => {
    const html = renderDiscoveryHtml(buildDiscovery({ options: keyed }))
    expect(html).toContain("Authentication is required")
    expect(html).not.toMatch(/<h2>(App|Models|Catalog)<\/h2>/)
  })
})

describe("#56 buildStatus", () => {
  const runtime = {
    runtimeVersion: 8,
    generations: 2,
    pumpRunning: true,
    guards: 3,
    startedAt: Date.UTC(2026, 9, 11),
    servingConfirmed: true,
    listener: { host: "127.0.0.1", port: 4010, bound: true },
  }

  test("runtime facts, uptime and model counts for the authenticated app", () => {
    expect(buildStatus({ options: testOptions({ metrics: true }), app: "alpha", runtime, catalog: CATALOG, now: Date.UTC(2026, 9, 11, 0, 1, 30) })).toEqual({
      ok: true,
      app: "alpha",
      runtimeVersion: 8,
      startedAt: "2026-10-11T00:00:00.000Z",
      uptimeSeconds: 90,
      listen: { host: "127.0.0.1", port: 4010, bound: true },
      generations: 2,
      servingConfirmed: true,
      eventPump: { running: true },
      sessionGuards: 3,
      models: { catalog: 3, available: 4 },
      metrics: true,
      circuitBreaker: { enabled: true, cooling: [] },
    })
  })

  test("the targets cooling down, and whether the breaker is on", () => {
    const until = Date.UTC(2026, 9, 11, 0, 2)
    const cooldowns = [{ model: "a/x", state: "open" as const, failures: 3, until }]
    expect(buildStatus({ options: testOptions(), runtime: { ...runtime, cooldowns }, now: until - 1000 })).toMatchObject({
      circuitBreaker: { enabled: true, cooling: [{ model: "a/x", state: "open", failures: 3, until: "2026-10-11T00:02:00.000Z" }] },
    })
    expect(buildStatus({ options: testOptions({ circuitBreaker: false }), runtime, now: until })).toMatchObject({ circuitBreaker: { enabled: false, cooling: [] } })
  })

  test("#347 the package version and the host OpenCode version come first, and an unknown OpenCode version is left out", () => {
    const status = buildStatus({ options: testOptions(), runtime, catalog: CATALOG, packageVersion: "0.30.0", opencodeVersion: "2.0.27", now: Date.UTC(2026, 9, 11) }) as Record<string, unknown>
    expect(status).toMatchObject({ packageVersion: "0.30.0", opencodeVersion: "2.0.27", runtimeVersion: 8 })
    expect(Object.keys(buildStatus({ options: testOptions(), runtime, packageVersion: "0.30.0", now: Date.UTC(2026, 9, 11) }))).not.toContain("opencodeVersion")
  })

  test("without a catalog the models field says so; without a listener bound is false", () => {
    const { listener: _, ...noListener } = runtime
    expect(buildStatus({ options: testOptions(), app: "a", runtime: noListener, now: runtime.startedAt })).toMatchObject({ models: { error: "catalog_unavailable" }, listen: { bound: false } })
  })
})
