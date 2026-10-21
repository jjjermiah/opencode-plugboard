import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import type { PlugError } from "../../src/contract.js"
import { effortVariant, filterByCapability, fromSlug, listAvailableModels, parseCapability, refToString, resolveModel, thinkingUnavailable, toSlug } from "../../src/models.js"
import { CATALOG, model, testOptions } from "../support/fixtures.js"

const notAvailable = (name: string): PlugError => ({
  status: 404,
  kind: "not_found",
  code: "model_not_found",
  param: "model",
  message: `Model ${name} is not available. GET /v1/models lists the models you can call.`,
})

describe("resolveModel: allowlist patterns", () => {
  const cases: Array<[string, string[], string, object]> = [
    ["provider/* allows any model of the provider", ["test/*"], "test/vision", { providerID: "test", id: "vision" }],
    ["provider/* allows variants too", ["test/*"], "test/echo#high", { providerID: "test", id: "echo", variant: "high" }],
    ["provider/model allows the model", ["test/echo"], "test/echo", { providerID: "test", id: "echo" }],
    ["provider/model allows each variant", ["test/echo"], "test/echo#low", { providerID: "test", id: "echo", variant: "low" }],
    ["provider/model#variant allows that variant", ["test/echo#high"], "test/echo#high", { providerID: "test", id: "echo", variant: "high" }],
    ["provider/model#variant does not allow the base model", ["test/echo#high"], "test/echo", notAvailable("test/echo")],
    ["provider/model#variant does not allow another variant", ["test/echo#high"], "test/echo#low", notAvailable("test/echo#low")],
    ["another provider's wildcard does not match", ["other/*"], "test/echo", notAvailable("test/echo")],
    ["an allowed model missing from the catalog is not available", ["test/*"], "test/ghost", notAvailable("test/ghost")],
    ["a variant the catalog does not list is not available", ["test/*"], "test/echo#max", notAvailable("test/echo#max")],
    ["a model string without a provider is not available", ["test/*"], "echo", notAvailable("echo")],
    ["an empty variant is not available", ["test/*"], "test/echo#", notAvailable("test/echo#")],
  ]
  test.each(cases)("%s", (_name, models, requested, expected) => {
    expect(resolveModel(testOptions({ models }), requested, CATALOG)).toEqual(expected as never)
  })

  test("an empty allowlist is a 403 no_models_configured, before any lookup", () => {
    expect(resolveModel(testOptions({ models: [] }), "test/echo", CATALOG)).toMatchObject({ status: 403, code: "no_models_configured" })
  })

  test("all allows every model the catalog has, and only those", () => {
    const options = testOptions({ models: "all" })
    expect(resolveModel(options, "other/model", CATALOG)).toEqual({ providerID: "other", id: "model" })
    expect(resolveModel(options, "test/echo#high", CATALOG)).toEqual({ providerID: "test", id: "echo", variant: "high" })
    expect(resolveModel(options, "test/ghost", CATALOG)).toEqual(notAvailable("test/ghost"))
    expect(resolveModel(options, "test/echo#max", CATALOG)).toEqual(notAvailable("test/echo#max"))
    expect(resolveModel(options, "echo", CATALOG)).toEqual(notAvailable("echo"))
  })

  test("all lists the whole catalog, plus aliases whose target is in it", () => {
    const options = testOptions({ models: "all", aliases: { fast: "other/model", gone: "ghost/model" } })
    expect(listAvailableModels(options, CATALOG).map((entry) => entry.id)).toEqual(["test/echo", "test/echo#low", "test/echo#high", "test/vision", "other/model", "fast"])
    expect(resolveModel(options, "fast", CATALOG)).toEqual({ providerID: "other", id: "model" })
    expect(resolveModel(options, "gone", CATALOG)).toEqual(notAvailable("gone"))
  })

  test("model ids may contain slashes (openrouter/vendor/model)", () => {
    const catalog = [model("openrouter", "vendor/model")]
    expect(resolveModel(testOptions({ models: ["openrouter/*"] }), "openrouter/vendor/model", catalog)).toEqual({ providerID: "openrouter", id: "vendor/model" })
  })
})

describe("resolveModel: aliases and reasoning effort", () => {
  const options = testOptions({ aliases: { fast: "test/echo#low", plain: "test/echo", blocked: "other/model" } })

  test("an alias resolves to its target", () => {
    expect(resolveModel(options, "fast", CATALOG)).toEqual({ providerID: "test", id: "echo", variant: "low" })
  })

  test("an alias whose target the allowlist refuses is not available", () => {
    expect(resolveModel(options, "blocked", CATALOG)).toEqual(notAvailable("blocked"))
  })

  test("an alias name that only exists on Object.prototype is not an alias", () => {
    expect(resolveModel(options, "toString", CATALOG)).toEqual(notAvailable("toString"))
  })

  test("reasoning effort picks the variant of that name when the model has it", () => {
    expect(resolveModel(options, "plain", CATALOG, "high")).toEqual({ providerID: "test", id: "echo", variant: "high" })
  })

  test("reasoning effort above every variant the model has runs on the highest one (#410)", () => {
    expect(resolveModel(options, "test/echo", CATALOG, "max")).toEqual({ providerID: "test", id: "echo", variant: "high" })
  })

  test("a budget that maps to a variant the model lacks runs on the nearest one above it (#410)", () => {
    // Claude Haiku 4.5 lists only high and max: a thinking budget of 1500 is effort low, which runs on high.
    const haiku = [model("anthropic", "claude-haiku-4-5", { variants: ["high", "max"] })]
    const allowed = testOptions({ models: ["anthropic/*"] })
    expect(resolveModel(allowed, "anthropic/claude-haiku-4-5", haiku, "low")).toEqual({ providerID: "anthropic", id: "claude-haiku-4-5", variant: "high" })
    expect(resolveModel(allowed, "anthropic/claude-haiku-4-5", haiku, "medium")).toEqual({ providerID: "anthropic", id: "claude-haiku-4-5", variant: "high" })
  })

  test("a model with no thinking variant ignores reasoning effort (#410)", () => {
    const plain = [model("test", "plain", { variants: ["fast"] })]
    expect(resolveModel(testOptions({ models: ["test/*"] }), "test/plain", plain, "high")).toEqual({ providerID: "test", id: "plain" })
  })

  test("an explicit variant wins over reasoning effort", () => {
    expect(resolveModel(options, "fast", CATALOG, "high")).toEqual({ providerID: "test", id: "echo", variant: "low" })
  })
})

describe("effortVariant (#410)", () => {
  test.each([
    ["the same name when the model has it", ["low", "high"], "high", "high"],
    ["the nearest variant at or above the effort", ["high", "max"], "low", "high"],
    ["the nearest at or above, not the highest", ["low", "high", "max"], "medium", "high"],
    ["the highest when none is at or above", ["low", "medium"], "xhigh", "medium"],
    ["the lowest thinking variant for minimal", ["low", "high"], "minimal", "low"],
    ["nothing when the model has no thinking variant", ["fast"], "low", undefined],
    ["nothing when the model has no variants", [], "high", undefined],
    ["nothing for none, so a request without thinking stays without it", ["high"], "none", undefined],
    ["nothing for a name outside the thinking order", ["high"], "banana", undefined],
    ["none when the model names none as a variant", ["none", "high"], "none", "none"],
  ])("%s", (_name, variants, effort, expected) => {
    expect(effortVariant(variants, effort)).toBe(expected)
  })

  test("thinkingUnavailable is true only for a model with no thinking variant", () => {
    const catalog = [model("test", "plain", { variants: ["fast"] }), model("test", "thinker", { variants: ["high"] })]
    expect(thinkingUnavailable(catalog, { providerID: "test", id: "plain" })).toBe(true)
    expect(thinkingUnavailable(catalog, { providerID: "test", id: "thinker" })).toBe(false)
    expect(thinkingUnavailable(catalog, { providerID: "test", id: "missing" })).toBe(false)
  })
})

describe("listAvailableModels", () => {
  test("lists the allowlist intersected with the catalog: base ids, then variants, then aliases", () => {
    const options = testOptions({ models: ["test/echo", "other/*"], aliases: { fast: "test/echo#low", nope: "test/vision" } })
    expect(listAvailableModels(options, CATALOG).map((entry) => entry.id)).toEqual(["test/echo", "test/echo#low", "test/echo#high", "other/model", "fast"])
  })

  test("a variant pattern lists only that variant", () => {
    expect(listAvailableModels(testOptions({ models: ["test/echo#high"] }), CATALOG).map((entry) => entry.id)).toEqual(["test/echo#high"])
  })

  test("a model the catalog lists twice (and repeated variants) is listed once", () => {
    const catalog = [model("test", "echo", { variants: ["low", "low"] }), model("test", "echo")]
    expect(listAvailableModels(testOptions(), catalog).map((entry) => entry.id)).toEqual(["test/echo", "test/echo#low"])
  })

  test("each entry carries its ref and catalog model", () => {
    const [entry] = listAvailableModels(testOptions({ models: ["test/vision"] }), CATALOG)
    expect(entry).toEqual({ id: "test/vision", ref: { providerID: "test", id: "vision" }, model: CATALOG[1]! })
  })
})

describe("toSlug and fromSlug: UI-safe model ids", () => {
  test("toSlug turns `/` into `--` and `#` into `__`", () => {
    expect(toSlug("anthropic/claude-haiku-4-5#high")).toBe("anthropic--claude-haiku-4-5__high")
    expect(toSlug("openrouter/vendor/model")).toBe("openrouter--vendor--model")
  })

  test.each(["test/echo", "test/echo#high", "openrouter/vendor/model", "openrouter/vendor/model#low", "other/model"])("%s round trips through its slug", (id) => {
    expect(fromSlug(toSlug(id))).toBe(id)
  })

  test("any provider, model and variant built from plain segments round trips", () => {
    const segment = fc.stringMatching(/^[a-z0-9]{1,8}$/)
    const canonical = fc.tuple(segment, fc.array(segment, { minLength: 1, maxLength: 3 }), fc.option(fc.stringMatching(/^[a-z0-9]{1,6}$/), { nil: undefined }))
    fc.assert(
      fc.property(canonical, ([providerID, parts, variant]) => {
        const id = refToString({ providerID, id: parts.join("/"), ...(variant ? { variant } : {}) })
        expect(fromSlug(toSlug(id))).toBe(id)
      }),
    )
  })

  test.each(["", "test/echo", "fast", "--echo", "test--", "__", "test--echo__", "test--echo__high__x", "test--echo#high", "test--ec ho", "test--echo/x"])("fromSlug rejects %p", (junk) => {
    expect(fromSlug(junk)).toBeUndefined()
  })
})

describe("resolveModel: slugs", () => {
  test.each(["test/echo", "test/echo#high", "test/vision", "other/model"])("the slug of %s resolves to the same model as the canonical id", (id) => {
    const options = testOptions({ models: ["test/*", "other/*"] })
    expect(resolveModel(options, toSlug(id), CATALOG)).toEqual(resolveModel(options, id, CATALOG))
  })

  test("a slug and a canonical id both resolve, whatever modelIds lists", () => {
    const options = testOptions({ modelIds: "slugs" })
    expect(resolveModel(options, "test--echo__high", CATALOG)).toEqual({ providerID: "test", id: "echo", variant: "high" })
    expect(resolveModel(options, "test/echo#high", CATALOG)).toEqual({ providerID: "test", id: "echo", variant: "high" })
  })

  test("a slug of a model the allowlist refuses is not available", () => {
    expect(resolveModel(testOptions({ models: ["test/echo"] }), "test--vision", CATALOG)).toEqual(notAvailable("test--vision"))
  })

  test("a slug takes the reasoning effort variant like a canonical id", () => {
    expect(resolveModel(testOptions(), "test--echo", CATALOG, "high")).toEqual({ providerID: "test", id: "echo", variant: "high" })
  })

  test("an alias wins over a slug with the same spelling", () => {
    const options = testOptions({ models: ["test/*", "other/*"], aliases: { "test--echo": "other/model" } })
    expect(resolveModel(options, "test--echo", CATALOG)).toEqual({ providerID: "other", id: "model" })
  })
})

describe("listAvailableModels: modelIds", () => {
  const aliases = { fast: "test/echo#low" }

  test("canonical lists only canonical ids (the default)", () => {
    expect(listAvailableModels(testOptions({ models: ["test/echo", "other/*"], aliases }), CATALOG).map((entry) => entry.id)).toEqual([
      "test/echo",
      "test/echo#low",
      "test/echo#high",
      "other/model",
      "fast",
    ])
  })

  test("slugs lists each model's slug in place of its canonical id, aliases unchanged", () => {
    const options = testOptions({ modelIds: "slugs", models: ["test/echo", "other/*"], aliases })
    expect(listAvailableModels(options, CATALOG).map((entry) => entry.id)).toEqual(["test--echo", "test--echo__low", "test--echo__high", "other--model", "fast"])
  })

  test("both lists each canonical id followed by its slug, aliases unchanged", () => {
    const options = testOptions({ modelIds: "both", models: ["test/echo", "other/*"], aliases })
    expect(listAvailableModels(options, CATALOG).map((entry) => entry.id)).toEqual([
      "test/echo",
      "test--echo",
      "test/echo#low",
      "test--echo__low",
      "test/echo#high",
      "test--echo__high",
      "other/model",
      "other--model",
      "fast",
    ])
  })

  test("a slug entry carries the same ref and catalog model as its canonical id", () => {
    const [canonical, slug] = listAvailableModels(testOptions({ modelIds: "both", models: ["test/vision"] }), CATALOG)
    expect(slug).toEqual({ ...canonical!, id: "test--vision" })
  })

  test("a model whose slug would not resolve back is left out of slugs, and kept under canonical and both", () => {
    const catalog = [model("test", "a--b")]
    expect(listAvailableModels(testOptions({ modelIds: "slugs" }), catalog)).toEqual([])
    expect(listAvailableModels(testOptions({ modelIds: "canonical" }), catalog).map((entry) => entry.id)).toEqual(["test/a--b"])
    expect(listAvailableModels(testOptions({ modelIds: "both" }), catalog).map((entry) => entry.id)).toEqual(["test/a--b"])
  })
})

describe("filterByCapability", () => {
  const listed = listAvailableModels(testOptions({ models: ["test/*", "other/*"] }), CATALOG)
  const ids = (capability: Parameters<typeof filterByCapability>[1]) => filterByCapability(listed, capability).map((entry) => entry.id)

  test("vision keeps the models whose catalog entry reports image input", () => {
    expect(ids("vision")).toEqual(["test/vision"])
  })

  test("tools keeps every model whose catalog entry reports tool support, variants included", () => {
    expect(ids("tools")).toEqual(["test/echo", "test/echo#low", "test/echo#high", "test/vision"])
  })

  test("a model without capability metadata matches no capability", () => {
    expect(filterByCapability(listAvailableModels(testOptions({ models: ["other/*"] }), CATALOG), "tools")).toEqual([])
  })

  test("parseCapability accepts vision and tools; json and anything else name no capability", () => {
    expect(parseCapability("vision")).toBe("vision")
    expect(parseCapability("tools")).toBe("tools")
    expect(parseCapability("json")).toBeUndefined()
    expect(parseCapability("toString")).toBeUndefined()
    expect(parseCapability("")).toBeUndefined()
  })
})
