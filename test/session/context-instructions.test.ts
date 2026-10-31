/**
 * #586 OpenCode's instruction files (the global and project `AGENTS.md`) never reach the model of a request session. The host builds a
 * request session's system prompt with them, and the context hook then replaces the system prompt and the messages with the caller's.
 * Measured on OpenCode 2.1.4: a 16,784-character `AGENTS.md` left `prompt_tokens` for "say pong" at 11, with and without it.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { PlugRequest } from "../../src/contract.js"
import { installSessionHooks } from "../../src/session/context.js"
import type { ContextHookEvent } from "../../src/session/host.js"
import { createSessionStore } from "../../src/session/state.js"
import { plugRequest } from "../support/fixtures.js"
import { spyContext } from "../support/plugin-context.js"

const SENTINEL = "INSTRUCTION_FILE_SENTINEL_5517"

function run(request: PlugRequest, event: ContextHookEvent): ContextHookEvent {
  const sessions = createSessionStore()
  sessions.register({ sessionID: "ses_1", app: "app", requestID: "r", request, collector: { push: () => {} } })
  const spy = spyContext({ directory: "/data/app" })
  Effect.runSync(Effect.scoped(installSessionHooks(spy.ctx, { maxTools: 4, sessions, active: () => true, apps: {} })))
  Effect.runSync(spy.registered<(event: unknown) => Effect.Effect<void>>("session.hook")(event))
  return event
}

describe("#586 instruction files in a request session", () => {
  test("the host's system prompt, instruction files included, is replaced by the caller's", () => {
    const event = run(plugRequest({ system: ["Be terse."] }), {
      sessionID: "ses_1",
      system: [
        { type: "text", text: `${SENTINEL} always answer in formal English` },
        { type: "text", text: "host agent prompt" },
      ],
      messages: [{ content: [{ type: "text", text: "## user\nsay pong" }] }],
      tools: {},
    } as unknown as ContextHookEvent)
    expect(JSON.stringify(event.system)).not.toContain(SENTINEL)
    expect(JSON.stringify(event.system)).not.toContain("host agent prompt")
    expect(JSON.stringify(event.system)).toContain("Be terse.")
  })

  test("a message the host built from instruction files does not survive either, for an app without OpenCode tools", () => {
    const event = run(plugRequest({ messages: [{ role: "user", content: [{ type: "text", text: "say pong" }] }] }), {
      sessionID: "ses_1",
      system: [],
      messages: [{ content: [{ type: "text", text: `${SENTINEL} instruction message` }] }, { content: [{ type: "text", text: "## user\nsay pong" }] }],
      tools: {},
    } as unknown as ContextHookEvent)
    expect(JSON.stringify(event.messages)).not.toContain(SENTINEL)
    expect(JSON.stringify(event.messages)).toContain("say pong")
  })
})
