/**
 * The host catalog (`loadCatalog`, src/session/host.ts) and its OpenAI listing (#74): tolerant of
 * whatever `ctx.model.list` returns, and carrying limits, modalities, cost, status, family and
 * release date through to `/v1/models`.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { listAvailableModels } from "../../src/models.js"
import { encodeModelList } from "../../src/openai/response.js"
import { loadCatalog } from "../../src/session/host.js"
import { testOptions } from "../support/fixtures.js"
import { spyContext } from "../support/plugin-context.js"

const load = (data: unknown[]) => loadCatalog(spyContext({ directory: "/p", respond: { "model.list": () => Effect.succeed({ data }) } }).ctx)

describe("loadCatalog", () => {
  test("disabled models and entries without provider or id are dropped; modelID wins over id", async () => {
    expect(
      await load([
        { providerID: "a", id: "off", enabled: false },
        { providerID: "a" },
        { id: "x" },
        "junk",
        { providerID: "a", id: "internal", modelID: "public" },
      ]),
    ).toEqual([{ providerID: "a", id: "public", variants: [] }])
  })

  test("variants may be strings or { id }; duplicates and empties are dropped", async () => {
    expect((await load([{ providerID: "a", id: "m", variants: ["low", { id: "high" }, "low", "", { id: 1 }] }]))[0]!.variants).toEqual(["low", "high"])
  })

  test("#74 limits, modalities, cost tiers, status, family and release date are carried as reported", async () => {
    const [entry] = await load([
      {
        providerID: "a",
        id: "m",
        name: "Model M",
        capabilities: { tools: true, input: ["text", "image", 3], output: ["text"] },
        limit: { context: 200_000, output: 8_000, input: "x" },
        cost: [
          { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
          { input: 6, output: 22.5, tier: { type: "context", size: 200_000 } },
          { input: "free" },
        ],
        status: "beta",
        family: "m-family",
        time: { released: Date.UTC(2026, 0, 2) },
      },
    ])
    expect(entry).toEqual({
      providerID: "a",
      id: "m",
      name: "Model M",
      variants: [],
      capabilities: { tools: true, image: true },
      contextLimit: 200_000,
      limits: { context: 200_000, output: 8_000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      cost: [
        { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        { input: 6, output: 22.5, cacheRead: 0, cacheWrite: 0, aboveContext: 200_000 },
      ],
      status: "beta",
      family: "m-family",
      released: Date.UTC(2026, 0, 2),
    })
  })

  test("an unknown status and a non-finite release date are left out", async () => {
    const [entry] = await load([{ providerID: "a", id: "m", status: "legacy", time: { released: Number.NaN } }])
    expect(entry).not.toHaveProperty("status")
    expect(entry).not.toHaveProperty("released")
  })
})

describe("#74 /v1/models entries carry the catalog metadata", () => {
  test("cost per million tokens with cache and context tiers, release date as ISO 8601", async () => {
    const catalog = await load([
      { providerID: "a", id: "m", limit: { context: 1000 }, cost: [{ input: 1, output: 2, cache: { read: 0.1 } }, { input: 2, output: 4, tier: { type: "context", size: 500 } }], time: { released: Date.UTC(2026, 0, 2) }, family: "f" },
    ])
    const body = encodeModelList(listAvailableModels(testOptions({ models: ["a/*"] }), catalog)) as { data: Array<{ plugboard: unknown }> }
    expect(body.data[0]!.plugboard).toEqual({
      capabilities: {},
      contextLimit: 1000,
      limit: { context: 1000 },
      modalities: undefined,
      cost: [
        { input: 1, output: 2, cache: { read: 0.1, write: 0 } },
        { input: 2, output: 4, cache: { read: 0, write: 0 }, aboveContext: 500 },
      ],
      status: undefined,
      family: "f",
      released: "2026-01-02T00:00:00.000Z",
    })
  })
})
