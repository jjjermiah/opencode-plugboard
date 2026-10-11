/**
 * #73 discovery pages and `/v1/status` (src/discovery.ts): pure builders. The disclosure rule is
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
      catalog: { providers: [{ id: "other", models: 1, examples: ["other/model"] }, { id: "test", models: 2, examples: ["test/echo", "test/vision"] }] },
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

  test("/metrics is listed only when enabled", () => {
    const paths = (options = keyless) => buildDiscovery({ options }).endpoints.map((endpoint) => endpoint.path)
    expect(paths()).not.toContain("/metrics")
    expect(paths(testOptions({ metrics: true }))).toContain("/metrics")
  })

  test("an IPv6 listen address is bracketed in the base URL", () => {
    expect(buildDiscovery({ options: testOptions({ listen: { host: "::1", port: 9 } }) }).baseUrl).toBe("http://[::1]:9/v1")
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
  const runtime = { runtimeVersion: 8, generations: 2, pumpRunning: true, guards: 3, startedAt: Date.UTC(2026, 9, 11), servingConfirmed: true, listener: { host: "127.0.0.1", port: 4010, bound: true } }

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
    })
  })

  test("without a catalog the models field says so; without a listener bound is false", () => {
    const { listener: _, ...noListener } = runtime
    expect(buildStatus({ options: testOptions(), app: "a", runtime: noListener, now: runtime.startedAt })).toMatchObject({ models: { error: "catalog_unavailable" }, listen: { bound: false } })
  })
})
