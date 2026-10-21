/**
 * #79 skill aliases and #6 agents at the policy layer: alias target syntax, persona lookup, what a
 * request name resolves to, and what `/v1/models` lists. The session side is test/session/persona.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"
import { listAvailableModels, parseAliasTarget, personaOf, resolveModel } from "../../src/models.js"
import { CATALOG } from "../support/fixtures.js"

const options = parseOptions({
  models: ["test/*"],
  keys: { bot: "k1", ops: "k2" },
  aliases: { "invoice-parser": "skill:invoice-parser@test/echo#low", fast: "test/echo#low" },
  agents: [
    { name: "review", model: "test/echo#high" },
    { name: "research", model: "test/missing" },
  ],
  apps: { bot: { key: "k1", allowedModels: ["invoice-parser"] } },
})

describe("#79 parseAliasTarget", () => {
  test("a skill target names its skill and model", () => {
    expect(parseAliasTarget("skill:invoice-parser@anthropic/claude-sonnet-4-6#high")).toEqual({
      ref: { providerID: "anthropic", id: "claude-sonnet-4-6", variant: "high" },
      skill: "invoice-parser",
    })
  })

  test("a plain target names a model and no skill", () => {
    expect(parseAliasTarget("openai/gpt-mini")).toEqual({ ref: { providerID: "openai", id: "gpt-mini" } })
  })

  test.each([
    ["an empty skill id", "skill:@anthropic/claude-sonnet-4-6"],
    ["a skill id with an @", "skill:a@b@anthropic/claude-sonnet-4-6"],
    ["no @ between id and model", "skill:invoice-parser"],
    ["a model that is not provider/model", "skill:invoice-parser@claude"],
  ])("#79 %s is not a target", (_name, target) => {
    expect(parseAliasTarget(target)).toBeUndefined()
  })
})

describe("#79 #6 personaOf", () => {
  test("a skill alias is a skill persona", () => {
    expect(personaOf(options, "invoice-parser")).toEqual({ kind: "skill", skill: "invoice-parser" })
  })

  test("agent/<name> of a configured agent is an agent persona", () => {
    expect(personaOf(options, "agent/review")).toEqual({ kind: "agent", agent: "review" })
  })

  test("a plain alias, a model id, an unknown agent and an unknown name have no persona", () => {
    expect(personaOf(options, "fast")).toBeUndefined()
    expect(personaOf(options, "test/echo")).toBeUndefined()
    expect(personaOf(options, "agent/none")).toBeUndefined()
    expect(personaOf(options, "nothing")).toBeUndefined()
  })
})

describe("#79 resolveModel", () => {
  test("a skill alias resolves to the model it binds", () => {
    expect(resolveModel(options, "invoice-parser", CATALOG)).toEqual({ providerID: "test", id: "echo", variant: "low" })
  })

  test("an agent resolves to the model its entry names", () => {
    expect(resolveModel(options, "agent/review", CATALOG)).toEqual({ providerID: "test", id: "echo", variant: "high" })
  })

  test("an agent whose model is not in the catalog is a 404 model_not_found naming the agent", () => {
    expect(resolveModel(options, "agent/research", CATALOG)).toMatchObject({
      status: 404,
      code: "model_not_found",
      message: "Model agent/research is not available. GET /v1/models lists the models you can call.",
    })
  })

  test("an unknown agent is the same 404 as any unknown model", () => {
    expect(resolveModel(options, "agent/none", CATALOG)).toMatchObject({ status: 404, code: "model_not_found" })
  })

  test("a plain alias and a model id resolve as before", () => {
    expect(resolveModel(options, "fast", CATALOG)).toEqual({ providerID: "test", id: "echo", variant: "low" })
    expect(resolveModel(options, "test/echo", CATALOG)).toEqual({ providerID: "test", id: "echo" })
  })
})

describe("#79 #6 listAvailableModels", () => {
  test("a skill alias is listed under its name with its skill, and an agent as agent/<name> with its agent", () => {
    const listed = listAvailableModels(options, CATALOG)
    expect(listed.find((m) => m.id === "invoice-parser")).toMatchObject({ skill: "invoice-parser", ref: { providerID: "test", id: "echo", variant: "low" } })
    expect(listed.find((m) => m.id === "agent/review")).toMatchObject({ agent: "review", ref: { providerID: "test", id: "echo", variant: "high" } })
    // The plain alias carries no skill, and an agent whose model is not in the catalog is not listed.
    expect(listed.find((m) => m.id === "fast")).not.toHaveProperty("skill")
    expect(listed.some((m) => m.id === "agent/research")).toBe(false)
  })

  test("an app's models narrow the skill and agent entries like any other name", () => {
    expect(listAvailableModels(options, CATALOG, "bot").map((m) => m.id)).toEqual(["invoice-parser"])
  })
})
