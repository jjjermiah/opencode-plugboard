import { describe, expect, test } from "bun:test"
import type { PlugError } from "../../src/contract.js"
import { listAvailableModels, resolveModel } from "../../src/models.js"
import { CATALOG, model, testOptions } from "../support/fixtures.js"

const notAvailable = (name: string): PlugError => ({ status: 404, kind: "not_found", code: "model_not_found", param: "model", message: `Model ${name} is not available` })

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

  test("reasoning effort is ignored when the model has no such variant", () => {
    expect(resolveModel(options, "test/echo", CATALOG, "max")).toEqual({ providerID: "test", id: "echo" })
  })

  test("an explicit variant wins over reasoning effort", () => {
    expect(resolveModel(options, "fast", CATALOG, "high")).toEqual({ providerID: "test", id: "echo", variant: "low" })
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
