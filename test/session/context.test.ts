/**
 * The context hook (src/session/context.ts): for a registered request session it replaces the
 * stored transcript with the caller's structured system, messages, tools and generation options,
 * and re-keys the seed tools by descriptor identity. Everything is a no-op until the Location is
 * a confirmed app directory.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { PlugRequest } from "../../src/contract.js"
import { installSessionHooks } from "../../src/session/context.js"
import type { ContextHookEvent, HostToolDescriptor } from "../../src/session/host.js"
import { createSessionStore } from "../../src/session/state.js"
import { plugRequest } from "../support/fixtures.js"
import { spyContext } from "../support/plugin-context.js"

const tool = (name: string) => ({ name, description: `${name} tool`, parameters: { type: "object", properties: { [name]: { type: "string" } } } })
const seeds = (count: number): Record<string, HostToolDescriptor> =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`plugboard_seed_${index}`, { description: "placeholder", input: {} }]))

/** Installs the hooks on a spy context and returns a function that runs the context hook for `request`. */
function hook(request: PlugRequest, active = true) {
  const sessions = createSessionStore()
  const pushed: Array<Record<string, unknown>> = []
  sessions.register({ sessionID: "ses_1", app: "app", requestID: "r", request, collector: { push: (event) => void pushed.push(event) } })
  const spy = spyContext({ directory: "/data/app" })
  // The spy's registrations return Effect.void, so no scope is ever used.
  Effect.runSync(Effect.scoped(installSessionHooks(spy.ctx, { maxTools: 4, sessions, active: () => active })))
  const run = (event: ContextHookEvent) => {
    Effect.runSync(spy.registered<(event: unknown) => Effect.Effect<void>>("session.hook")(event))
    return event
  }
  return { run, pushed }
}

const event = (extra: Partial<ContextHookEvent> = {}): ContextHookEvent => ({
  sessionID: "ses_1",
  system: ["opencode system prompt"],
  messages: [{ content: [{ type: "text", text: "## user\nhello" }] }],
  options: { keep: true },
  tools: { ...seeds(4), read: { description: "a real OpenCode tool", input: {} } },
  ...extra,
})

describe("the context hook", () => {
  test("is a no-op while the Location is not confirmed", () => {
    const { run } = hook(plugRequest({ system: ["caller"] }), false)
    const before = event()
    const after = run(event())
    expect(after).toEqual(before)
  })

  test("leaves sessions that are not plugboard requests alone", () => {
    const { run } = hook(plugRequest())
    expect(run(event({ sessionID: "ses_other" })).system).toEqual(["opencode system prompt"])
  })

  test("swaps in the caller's system and messages, tool calls and results included", () => {
    const { run } = hook(
      plugRequest({
        system: ["be brief", "json please"],
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "lookup", input: { q: 1 } }] },
          { role: "tool", content: [{ type: "tool-result", id: "c1", name: "lookup", result: "42" }] },
        ],
      }),
    )
    const after = run(event())
    expect(after.system).toEqual([
      { type: "text", text: "be brief" },
      { type: "text", text: "json please" },
    ])
    expect(after.messages as unknown).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "lookup", input: { q: 1 } }] },
      { role: "tool", content: [{ type: "tool-result", id: "c1", name: "lookup", result: { type: "text", value: "42" } }] },
    ])
  })

  test.each([
    ["required", "You must respond by calling one of the provided tools."],
    [{ type: "tool", name: "lookup" }, "You must respond by calling the `lookup` tool."],
  ] as const)("tool_choice %j is steered by a system instruction", (choice, instruction) => {
    const { run } = hook(plugRequest({ tools: [tool("lookup")], toolChoice: choice }))
    expect(run(event()).system.at(-1)).toEqual({ type: "text", text: instruction })
  })

  test("generation options are merged into the host's options", () => {
    const { run } = hook(plugRequest({ generation: { maxTokens: 9, temperature: 0.2, topP: 0.5, stop: ["END"], presencePenalty: 1, frequencyPenalty: -1 } }))
    expect(run(event()).options).toEqual({ keep: true, maxTokens: 9, temperature: 0.2, topP: 0.5, stop: ["END"], presencePenalty: 1, frequencyPenalty: -1 })
    expect(run(event({ options: undefined })).options).toEqual({ maxTokens: 9, temperature: 0.2, topP: 0.5, stop: ["END"], presencePenalty: 1, frequencyPenalty: -1 })
  })

  test("caller images are the host-built media parts of the prompt files, in order", () => {
    const hostMedia = [{ type: "media", asset: "A" }, { type: "media", asset: "B" }]
    const { run } = hook(plugRequest({ messages: [{ role: "user", content: [{ type: "media", url: "data:x" }, { type: "text", text: "and" }, { type: "media", url: "data:y" }] }] }))
    const after = run(event({ messages: [{ content: [{ type: "text", text: "transcript" }, ...hostMedia] }] }))
    expect(after.messages as unknown).toEqual([{ role: "user", content: [hostMedia[0], { type: "text", text: "and" }, hostMedia[1]] }])
  })

  test("an image the host did not deliver fails the request instead of answering without it", () => {
    const { run, pushed } = hook(plugRequest({ messages: [{ role: "user", content: [{ type: "media", url: "data:x" }] }] }))
    const after = run(event())
    expect(after.messages as unknown).toEqual([{ role: "user", content: [{ type: "text", text: "[image unavailable]" }] }])
    expect(pushed).toEqual([{ type: "plugboard.failure", error: expect.objectContaining({ code: "backend_preparation_failed", message: expect.stringContaining("1 attachment(s) not delivered") }) }])
  })
})

describe("seed tools are re-keyed by descriptor identity", () => {
  test("each caller tool takes a seed descriptor, mutated in place; real tools and spare seeds disappear", () => {
    const { run } = hook(plugRequest({ tools: [tool("lookup"), tool("write")] }))
    const before = event()
    const [seed0, seed1] = [before.tools!.plugboard_seed_0!, before.tools!.plugboard_seed_1!]
    const after = run(before)
    expect(Object.keys(after.tools!)).toEqual(["lookup", "write"])
    expect(after.tools!.lookup).toBe(seed0)
    expect(after.tools!.write).toBe(seed1)
    expect(seed0).toEqual({ description: "lookup tool", input: tool("lookup").parameters })
  })

  test("tool_choice none offers no tools; a named choice offers only that one", () => {
    expect(hook(plugRequest({ tools: [tool("a")], toolChoice: "none" })).run(event()).tools).toEqual({})
    expect(Object.keys(hook(plugRequest({ tools: [tool("a"), tool("b")], toolChoice: { type: "tool", name: "b" } })).run(event()).tools!)).toEqual(["b"])
  })

  test("a tool named __proto__ stays an own key", () => {
    const after = hook(plugRequest({ tools: [tool("__proto__")] })).run(event())
    expect(Object.hasOwn(after.tools!, "__proto__")).toBe(true)
  })

  test("more caller tools than seeds fails the request", () => {
    const { run, pushed } = hook(plugRequest({ tools: [tool("a"), tool("b"), tool("c")] }))
    run(event({ tools: seeds(2) }))
    expect(pushed).toEqual([{ type: "plugboard.failure", error: expect.objectContaining({ code: "backend_preparation_failed", message: expect.stringContaining("1 tool(s) without a seed tool") }) }])
  })
})
