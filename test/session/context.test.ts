/**
 * The context hook (src/session/context.ts): for a registered request session it replaces the
 * stored transcript with the caller's structured system, messages, tools and generation options,
 * and re-keys the seed tools by descriptor identity. Everything is a no-op until the Location is
 * a confirmed app directory.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { PlugRequest } from "../../src/contract.js"
import { installSessionHooks, replaysSignedThinking } from "../../src/session/context.js"
import type { ContextHookEvent, HostToolDescriptor } from "../../src/session/host.js"
import { createSessionStore } from "../../src/session/state.js"
import { captureLogs } from "../support/logs.js"
import { plugRequest } from "../support/fixtures.js"
import { spyContext } from "../support/plugin-context.js"

const logs = captureLogs()

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

  test("generation options are merged into the host's options; stop sequences are not (#390)", () => {
    const { run } = hook(plugRequest({ generation: { maxTokens: 9, temperature: 0.2, topP: 0.5, stop: ["END"], presencePenalty: 1, frequencyPenalty: -1 } }))
    expect(run(event()).options).toEqual({ keep: true, maxTokens: 9, temperature: 0.2, topP: 0.5, presencePenalty: 1, frequencyPenalty: -1 })
    expect(run(event({ options: undefined })).options).toEqual({ maxTokens: 9, temperature: 0.2, topP: 0.5, presencePenalty: 1, frequencyPenalty: -1 })
  })

  test("#275 a caller cache breakpoint on a text, image or tool result becomes the host's ephemeral cache hint; a block without one has none", () => {
    const hostMedia = [{ type: "media", asset: "A" }]
    const { run } = hook(
      plugRequest({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "cached", cache: true },
              { type: "text", text: "plain" },
              { type: "media", url: "data:x", cache: true },
            ],
          },
          { role: "tool", content: [{ type: "tool-result", id: "c1", name: "lookup", result: "42", cache: true }] },
        ],
      }),
    )
    const after = run(event({ messages: [{ content: [{ type: "text", text: "transcript" }, ...hostMedia] }, { content: [{ type: "tool-result", id: "c1", name: "lookup" }] }] }))
    expect(after.messages as unknown).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "cached", cache: { type: "ephemeral" } },
          { type: "text", text: "plain" },
          { ...hostMedia[0], cache: { type: "ephemeral" } },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", id: "c1", name: "lookup", result: { type: "text", value: "42" }, cache: { type: "ephemeral" } }] },
    ])
  })

  test("#374 signed reasoning reaches the host as a reasoning part with the Anthropic signature, on an anthropic model only; elsewhere it is dropped, and a turn left empty with it", () => {
    const { run } = hook(
      plugRequest({
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "plan", signature: "sig_1" },
              { type: "reasoning", text: "", redactedData: "opaque" },
              { type: "text", text: "done" },
            ],
          },
          { role: "assistant", content: [{ type: "reasoning", text: "alone", signature: "sig_2" }] },
        ],
      }),
    )
    expect(run(event({ model: { providerID: "anthropic" } })).messages as unknown).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "plan", providerMetadata: { anthropic: { signature: "sig_1" } } },
          { type: "reasoning", text: "", providerMetadata: { anthropic: { redactedData: "opaque" } } },
          { type: "text", text: "done" },
        ],
      },
      { role: "assistant", content: [{ type: "reasoning", text: "alone", providerMetadata: { anthropic: { signature: "sig_2" } } }] },
    ])
    expect(run(event({ model: { providerID: "openai" } })).messages as unknown).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ])
  })

  test("#374 a host event without a model replays no reasoning and does not throw", () => {
    const { run } = hook(
      plugRequest({
        messages: [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "plan", signature: "sig_1" },
              { type: "text", text: "done" },
            ],
          },
        ],
      }),
    )
    expect(run(event()).messages as unknown).toEqual([{ role: "assistant", content: [{ type: "text", text: "done" }] }])
  })

  test("#386 signed reasoning replays to a Copilot Claude model; other Copilot models and other providers' Claude ids get none", () => {
    const { run } = hook(
      plugRequest({
        messages: [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "plan", signature: "sig_1" },
              { type: "text", text: "done" },
            ],
          },
        ],
      }),
    )
    expect(run(event({ model: { providerID: "github-copilot", id: "claude-haiku-5.5" } })).messages as unknown).toEqual([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "plan", providerMetadata: { anthropic: { signature: "sig_1" } } },
          { type: "text", text: "done" },
        ],
      },
    ])
    for (const model of [
      { providerID: "github-copilot", id: "gpt-5.2" },
      { providerID: "openrouter", id: "claude-haiku-5.5" },
    ]) {
      expect(run(event({ model })).messages as unknown).toEqual([{ role: "assistant", content: [{ type: "text", text: "done" }] }])
    }
  })

  test("#386 the replay gate: anthropic, and Copilot's claude-* models only", () => {
    expect(replaysSignedThinking({ providerID: "anthropic", id: "claude-opus-4-5" })).toBe(true)
    expect(replaysSignedThinking({ providerID: "github-copilot", id: "claude-haiku-5.5" })).toBe(true)
    expect(replaysSignedThinking({ providerID: "github-copilot", id: "gpt-5.2" })).toBe(false)
    expect(replaysSignedThinking({ providerID: "github-copilot" })).toBe(false)
    expect(replaysSignedThinking({ providerID: "openrouter", id: "anthropic/claude-haiku-5.5" })).toBe(false)
    expect(replaysSignedThinking(undefined)).toBe(false)
  })

  test("caller images are the host-built media parts of the prompt files, in order", () => {
    const hostMedia = [
      { type: "media", asset: "A" },
      { type: "media", asset: "B" },
    ]
    const { run } = hook(
      plugRequest({
        messages: [
          {
            role: "user",
            content: [
              { type: "media", url: "data:x" },
              { type: "text", text: "and" },
              { type: "media", url: "data:y" },
            ],
          },
        ],
      }),
    )
    const after = run(event({ messages: [{ content: [{ type: "text", text: "transcript" }, ...hostMedia] }] }))
    expect(after.messages as unknown).toEqual([{ role: "user", content: [hostMedia[0], { type: "text", text: "and" }, hostMedia[1]] }])
  })

  test("an image the host did not deliver fails the request instead of answering without it", () => {
    const { run, pushed } = hook(plugRequest({ messages: [{ role: "user", content: [{ type: "media", url: "data:x" }] }] }))
    const after = run(event())
    expect(after.messages as unknown).toEqual([{ role: "user", content: [{ type: "text", text: "[image unavailable]" }] }])
    // #288: the caller sees the generic message; the missing count goes to the log only.
    expect(pushed).toEqual([{ type: "plugboard.failure", error: { status: 500, kind: "server", code: "backend_preparation_failed", message: "Could not prepare the model request" } }])
    expect(logs.of("request.preparation_failed")[0]!.fields).toMatchObject({ missing_media: "1", missing_tools: "0" })
  })
})

/** The host's cache TTLs in wire order (system, then messages): 3600 for 1h, 300 for the default 5m. */
const wireTtls = (after: ContextHookEvent): number[] => {
  const parts = [...((after.system ?? []) as Array<{ cache?: { ttlSeconds?: number } }>), ...(after.messages ?? []).flatMap((m) => m.content as Array<{ cache?: { ttlSeconds?: number } }>)]
  return parts.filter((p) => p.cache !== undefined).map((p) => p.cache!.ttlSeconds ?? 300)
}
/** Anthropic: every 1h entry comes before every 5m one. */
const oneHourBeforeFiveMinute = (ttls: number[]) => ttls.lastIndexOf(3600) < (ttls.includes(300) ? ttls.indexOf(300) : Infinity)

describe("#275 the 1h TTL reaches the host only on a request without tools", () => {
  const hour = { type: "ephemeral", ttlSeconds: 3600 }
  const five = { type: "ephemeral" }

  test("no tools: the system first and last parts and the caller's 1h block are 1h; the tail after it keeps the 5m default", () => {
    const { run } = hook(
      plugRequest({
        system: ["one", "two", "three"],
        messages: [
          { role: "user", content: [{ type: "text", text: "ctx", cache: true, cacheTtl: "1h" }] },
          { role: "assistant", content: [{ type: "text", text: "ok" }] },
          { role: "user", content: [{ type: "text", text: "next" }] },
        ],
      }),
    )
    const after = run(
      event({ system: ["x", "y", "z"], messages: [{ content: [{ type: "text", text: "t" }] }, { content: [{ type: "text", text: "t" }] }, { content: [{ type: "text", text: "t" }] }] }),
    )
    expect(after.system).toEqual([
      { type: "text", text: "one", cache: hour },
      { type: "text", text: "two" },
      { type: "text", text: "three", cache: hour },
    ])
    expect(after.messages as unknown).toEqual([
      { role: "user", content: [{ type: "text", text: "ctx", cache: hour }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: [{ type: "text", text: "next" }] },
    ])
    expect(wireTtls(after)).toEqual([3600, 3600, 3600])
    expect(oneHourBeforeFiveMinute(wireTtls(after))).toBe(true)
  })

  test("no tools: a 5m caller block before the 1h block is raised to 1h, so no 5m precedes a 1h; a 5m block after it stays 5m", () => {
    const { run } = hook(
      plugRequest({
        messages: [
          { role: "user", content: [{ type: "text", text: "early", cache: true }] },
          { role: "user", content: [{ type: "text", text: "ctx", cache: true, cacheTtl: "1h" }] },
          { role: "user", content: [{ type: "text", text: "late", cache: true }] },
        ],
      }),
    )
    const after = run(event({ system: [], messages: [{ content: [{ type: "text", text: "a" }] }, { content: [{ type: "text", text: "b" }] }, { content: [{ type: "text", text: "c" }] }] }))
    expect(after.messages as unknown).toEqual([
      { role: "user", content: [{ type: "text", text: "early", cache: hour }] },
      { role: "user", content: [{ type: "text", text: "ctx", cache: hour }] },
      { role: "user", content: [{ type: "text", text: "late", cache: five }] },
    ])
    expect(wireTtls(after)).toEqual([3600, 3600, 300])
    expect(oneHourBeforeFiveMinute(wireTtls(after))).toBe(true)
  })

  test("no tools: two 1h blocks with a 5m block between them: the 5m block between is raised, the 5m after the last 1h stays", () => {
    const { run } = hook(
      plugRequest({
        messages: [
          { role: "user", content: [{ type: "text", text: "first", cache: true, cacheTtl: "1h" }] },
          { role: "user", content: [{ type: "text", text: "between", cache: true }] },
          { role: "user", content: [{ type: "text", text: "second", cache: true, cacheTtl: "1h" }] },
          { role: "user", content: [{ type: "text", text: "after", cache: true }] },
        ],
      }),
    )
    const after = run(
      event({
        system: [],
        messages: [{ content: [{ type: "text", text: "a" }] }, { content: [{ type: "text", text: "b" }] }, { content: [{ type: "text", text: "c" }] }, { content: [{ type: "text", text: "d" }] }],
      }),
    )
    expect(after.messages as unknown).toEqual([
      { role: "user", content: [{ type: "text", text: "first", cache: hour }] },
      { role: "user", content: [{ type: "text", text: "between", cache: hour }] },
      { role: "user", content: [{ type: "text", text: "second", cache: hour }] },
      { role: "user", content: [{ type: "text", text: "after", cache: five }] },
    ])
    expect(wireTtls(after)).toEqual([3600, 3600, 3600, 300])
    expect(oneHourBeforeFiveMinute(wireTtls(after))).toBe(true)
  })

  test("no tools: a whitespace-only text part with a hint before the 1h block is raised like any other part (the lowering skips it, but it is a hinted part on the host)", () => {
    const { run } = hook(
      plugRequest({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "   ", cache: true },
              { type: "text", text: "ctx", cache: true, cacheTtl: "1h" },
            ],
          },
        ],
      }),
    )
    const after = run(
      event({
        system: [],
        messages: [
          {
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "b" },
            ],
          },
        ],
      }),
    )
    expect(after.messages as unknown).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "   ", cache: hour },
          { type: "text", text: "ctx", cache: hour },
        ],
      },
    ])
    expect(wireTtls(after)).toEqual([3600, 3600])
  })

  test("no tools: a whitespace-only hinted text part as the tail, after the 1h block, stays 5m and is not pinned", () => {
    const { run } = hook(
      plugRequest({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "ctx", cache: true, cacheTtl: "1h" },
              { type: "text", text: "  ", cache: true },
            ],
          },
        ],
      }),
    )
    const after = run(
      event({
        system: [],
        messages: [
          {
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "b" },
            ],
          },
        ],
      }),
    )
    expect(after.messages as unknown).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "ctx", cache: hour },
          { type: "text", text: "  ", cache: five },
        ],
      },
    ])
    expect(wireTtls(after)).toEqual([3600, 300])
    expect(oneHourBeforeFiveMinute(wireTtls(after))).toBe(true)
  })

  test("no tools: the tail hint OpenCode would put on the last text part is pinned 1h when a 1h media block follows it", () => {
    const hostMedia = { type: "media", asset: "A" }
    const { run } = hook(
      plugRequest({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "question" },
              { type: "media", url: "data:x", cache: true, cacheTtl: "1h" },
            ],
          },
        ],
      }),
    )
    const after = run(event({ system: [], messages: [{ content: [{ type: "text", text: "transcript" }, hostMedia] }] }))
    expect(after.messages as unknown).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "question", cache: hour },
          { ...hostMedia, cache: hour },
        ],
      },
    ])
    expect(wireTtls(after)).toEqual([3600, 3600])
  })

  test("no tools, all 4 slots spent by the caller: no system slot is taken, and the earlier caller hints are raised to 1h", () => {
    const { run } = hook(
      plugRequest({
        system: ["s"],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "a", cache: true },
              { type: "text", text: "b", cache: true },
            ],
          },
          {
            role: "user",
            content: [
              { type: "text", text: "c", cache: true },
              { type: "text", text: "d", cache: true, cacheTtl: "1h" },
            ],
          },
        ],
      }),
    )
    const after = run(
      event({
        system: ["s"],
        messages: [
          {
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "b" },
            ],
          },
          {
            content: [
              { type: "text", text: "c" },
              { type: "text", text: "d" },
            ],
          },
        ],
      }),
    )
    expect(after.system).toEqual([{ type: "text", text: "s" }])
    expect(wireTtls(after)).toEqual([3600, 3600, 3600, 3600])
  })

  test("no tools, 3 slots spent by the caller: the first system part takes the last free slot and the last system part gets none", () => {
    const { run } = hook(
      plugRequest({
        system: ["s1", "s2"],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "a", cache: true },
              { type: "text", text: "b", cache: true },
              { type: "text", text: "c", cache: true, cacheTtl: "1h" },
            ],
          },
        ],
      }),
    )
    const after = run(
      event({
        system: ["s1", "s2"],
        messages: [
          {
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "b" },
              { type: "text", text: "c" },
            ],
          },
        ],
      }),
    )
    expect(after.system).toEqual([
      { type: "text", text: "s1", cache: hour },
      { type: "text", text: "s2" },
    ])
    expect(wireTtls(after)).toEqual([3600, 3600, 3600, 3600])
  })

  test("with tools present the 1h block stays the 5m default and the system gets no hint", () => {
    const { run } = hook(
      plugRequest({
        tools: [tool("lookup")],
        system: ["one", "two"],
        messages: [{ role: "user", content: [{ type: "text", text: "ctx", cache: true, cacheTtl: "1h" }] }],
      }),
    )
    const after = run(event({ system: ["x", "y"], messages: [{ content: [{ type: "text", text: "t" }] }] }))
    expect(after.system).toEqual([
      { type: "text", text: "one" },
      { type: "text", text: "two" },
    ])
    expect(after.messages as unknown).toEqual([{ role: "user", content: [{ type: "text", text: "ctx", cache: five }] }])
    expect(Object.keys(after.tools!)).toEqual(["lookup"])
  })

  test("tool_choice none sends no tools to the model, so the 1h TTL is carried", () => {
    const { run } = hook(
      plugRequest({
        tools: [tool("lookup")],
        toolChoice: "none",
        system: ["one", "two"],
        messages: [{ role: "user", content: [{ type: "text", text: "ctx", cache: true, cacheTtl: "1h" }] }],
      }),
    )
    const after = run(event({ system: ["x", "y"], messages: [{ content: [{ type: "text", text: "t" }] }] }))
    expect(after.tools).toEqual({})
    expect(after.system).toEqual([
      { type: "text", text: "one", cache: hour },
      { type: "text", text: "two", cache: hour },
    ])
    expect(after.messages as unknown).toEqual([{ role: "user", content: [{ type: "text", text: "ctx", cache: hour }] }])
  })

  test("no 1h block: the system and tail keep OpenCode's own 5m placement (nothing pinned)", () => {
    const { run } = hook(plugRequest({ system: ["one", "two"], messages: [{ role: "user", content: [{ type: "text", text: "ctx", cache: true }] }] }))
    const after = run(event({ system: ["x", "y"], messages: [{ content: [{ type: "text", text: "t" }] }] }))
    expect(after.system).toEqual([
      { type: "text", text: "one" },
      { type: "text", text: "two" },
    ])
    expect(after.messages as unknown).toEqual([{ role: "user", content: [{ type: "text", text: "ctx", cache: five }] }])
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
    expect(pushed).toEqual([{ type: "plugboard.failure", error: { status: 500, kind: "server", code: "backend_preparation_failed", message: "Could not prepare the model request" } }])
    expect(logs.of("request.preparation_failed")[0]!.fields).toMatchObject({ missing_media: "0", missing_tools: "1" })
  })
})
