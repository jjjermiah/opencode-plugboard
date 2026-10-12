/**
 * #79 and #6 over loopback HTTP: a skill alias and an agent are listed in `/v1/models` with their
 * `plugboard.skill` / `plugboard.agent` metadata, and a chat request naming one reaches the model caller
 * with the model the alias or agent entry binds. The session behaviour is test/session/persona.test.ts.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { CATALOG, ev } from "../support/fixtures.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const options = {
  models: ["test/*"],
  aliases: { "invoice-parser": "skill:invoice-parser@test/echo#low", fast: "test/echo#low" },
  agents: [{ name: "review", model: "test/echo#high" }],
}

async function start() {
  const caller = new FakeModelCaller(() => [ev.text("Hi"), ev.finish()])
  server = await startRoute({ caller, catalog: CATALOG, options })
  return caller
}

describe("#79 #6 model listing", () => {
  test("#79 a skill alias is listed under its name with plugboard.skill, and #6 an agent as agent/<name> with plugboard.agent", async () => {
    await start()
    const data = (await server!.send({ path: "/v1/models" })).json().data as Array<{ id: string; plugboard: Record<string, unknown> }>
    const skill = data.find((m) => m.id === "invoice-parser")
    const agent = data.find((m) => m.id === "agent/review")
    expect(skill?.plugboard).toMatchObject({ skill: "invoice-parser" })
    expect(agent?.plugboard).toMatchObject({ agent: "review" })
    expect(data.find((m) => m.id === "fast")?.plugboard).not.toHaveProperty("skill")
    expect(data.find((m) => m.id === "test/echo")?.plugboard).not.toHaveProperty("agent")
  })
})

describe("#79 #6 chat requests naming a skill or an agent", () => {
  test.each([
    ["invoice-parser", { providerID: "test", id: "echo", variant: "low" }],
    ["agent/review", { providerID: "test", id: "echo", variant: "high" }],
  ])("#79 #6 %s reaches the model caller on the model it binds", async (model, ref) => {
    const caller = await start()
    const reply = await server!.send({ method: "POST", path: "/v1/chat/completions", body: { model, messages: [{ role: "user", content: "hi" }] } })
    expect(reply.status).toBe(200)
    expect(caller.call.request).toMatchObject({ model, ref })
  })

  test("#6 an agent id that is not configured is a 404 model_not_found, and the model caller is never called", async () => {
    const caller = await start()
    const reply = await server!.send({ method: "POST", path: "/v1/chat/completions", body: { model: "agent/none", messages: [{ role: "user", content: "hi" }] } })
    expect(reply.status).toBe(404)
    expect(reply.json().error).toMatchObject({ code: "model_not_found" })
    expect(caller.calls.length).toBe(0)
  })
})
