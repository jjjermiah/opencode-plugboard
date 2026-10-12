/**
 * The opt-in live suite (#99): the same cells as the matrix (#108) run as tests against an isolated
 * OpenCode server, plus lifecycle checks. Skipped unless PLUGBOARD_LIVE=1, so `bun test` stays offline.
 *
 *   PLUGBOARD_LIVE=1 PLUGBOARD_LIVE_KEY=... bun test test/live
 *
 * Costs real tokens: about 120 calls with the default models, each tiny. A cell in `KNOWN` runs as
 * `test.failing`: it must still fail, and the day it passes the test goes red, so the entry is removed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { authHeaders, cleanup, listedModels, oc, recordSessions, sessionOf, sleep, status, until } from "./client.js"
import { ENDPOINTS, SCENARIOS, applicable, runCell } from "./cells.js"
import { KNOWN } from "./known.js"
import { LIVE, LIVE_KEY, LIVE_MODELS, LIVE_URL } from "./env.js"

const CALL_TIMEOUT = 180_000

describe.skipIf(!LIVE)("live: isolated OpenCode server (#99)", () => {
  beforeAll(async () => {
    if (!LIVE_KEY) throw new Error("PLUGBOARD_LIVE_KEY is required (the app key of the isolated server)")
    const health = await fetch(new URL("/healthz", LIVE_URL)).catch(() => undefined)
    if (!health?.ok) throw new Error(`${LIVE_URL}/healthz is not answering; see docs/development.md`)
    const listed = new Set(await listedModels())
    const missing = LIVE_MODELS.filter((model) => !listed.has(model))
    if (missing.length > 0) throw new Error(`not listed by GET /v1/models: ${missing.join(", ")}`)
  }, CALL_TIMEOUT)

  afterAll(async () => {
    const deleted = await cleanup()
    console.log(`live: deleted ${deleted} sessions created by this run; sessionGuards ${(await status()).sessionGuards}`)
  }, CALL_TIMEOUT)

  test("#99 pong gate: a normal prompt through the `fast` alias still answers", async () => {
    const cell = await runCell("fast", "chat", "text")
    expect(cell.detail).toBe("ok")
  }, CALL_TIMEOUT)

  for (const model of LIVE_MODELS) {
    describe(model, () => {
      for (const endpoint of ENDPOINTS)
        for (const scenario of SCENARIOS) {
          if (!applicable(endpoint, scenario)) continue
          const name = `#99 ${model} ${endpoint} ${scenario}`
          const known = KNOWN[model] ?? KNOWN[`${model}|${endpoint}|${scenario}`]
          const run = async () => {
            const cell = await runCell(model, endpoint, scenario)
            expect(cell.status === "pass" ? cell.detail : `${cell.status}: ${cell.detail}`).toBe("ok")
          }
          if (known) test.failing(`${name} (known: ${known})`, run, CALL_TIMEOUT)
          else test(name, run, CALL_TIMEOUT)
        }
    })
  }

  describe("lifecycle", () => {
    test("#99 a client disconnect mid-stream interrupts the request's session", async () => {
      const model = LIVE_MODELS[0]!
      // A long answer, so the stream is still running when the client hangs up. Only the first bytes are read.
      const body = {
        model,
        messages: [{ role: "user", content: "Write a 2000-word essay about the sea." }],
        max_tokens: 4000,
        stream: true,
      }
      const controller = new AbortController()
      const response = await fetch(new URL("/v1/chat/completions", LIVE_URL), {
        method: "POST",
        headers: { ...authHeaders("chat"), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const ids = recordSessions(response.headers)
      expect(response.status).toBe(200)
      const reader = response.body!.getReader()
      // Wait for the first bytes, then hang up while the model is still writing.
      const first = await Promise.race([reader.read(), sleep(60_000).then(() => undefined)])
      // A keepalive comment counts as live output; an error body does not.
      const firstText = new TextDecoder().decode(first?.value ?? new Uint8Array())
      expect(firstText.length).toBeGreaterThan(0)
      expect(firstText).not.toContain("\"error\"")
      // A stream that already finished would prove nothing: the request must still be in flight.
      expect((await status()).sessionGuards).toBeGreaterThan(0)
      controller.abort()

      const drained = await until(async () => ((await status()).sessionGuards === 0 ? true : undefined), 30_000)
      expect(drained).toBe(true)
      const id = ids[0]!
      const outcome = await until(async () => {
        const session = await sessionOf(id)
        return session.outcome === "interrupted" || session.outcome === "succeeded" || session.outcome === "failed" ? session.outcome : undefined
      }, 30_000)
      expect(outcome).toBe("interrupted")
    }, CALL_TIMEOUT)

    // The history of a request is one session. A tool turn is one assistant message: the call, then the
    // answer that follows its result, never two assistant messages for the same turn.
    const assistantMessages = async (id: string) => {
      const page = await oc("get", `/api/session/${id}/message`)
      return (page.data as Array<{ type: string; content?: Array<{ type: string }> }>).filter((message) => message.type === "assistant")
    }

    test("#99 history: a tool-call turn is one clean assistant message with one tool call", async () => {
      const cell = await runCell(LIVE_MODELS[0]!, "chat", "tool-call")
      expect(cell.status).toBe("pass")
      const assistant = await assistantMessages(cell.sessions[0]!)
      expect(assistant.length).toBe(1)
      expect(assistant[0]!.content!.filter((part) => part.type === "tool").length).toBe(1)
    }, CALL_TIMEOUT)

    test("#99 history: a tool-result turn is one assistant message, with the answer and no tool call", async () => {
      const cell = await runCell(LIVE_MODELS[0]!, "chat", "tool-result")
      expect(cell.status).toBe("pass")
      const assistant = await assistantMessages(cell.sessions[0]!)
      expect(assistant.length).toBe(1)
      expect(assistant[0]!.content!.filter((part) => part.type === "tool").length).toBe(0)
      expect(assistant[0]!.content!.filter((part) => part.type === "text").length).toBeGreaterThan(0)
    }, CALL_TIMEOUT)
  })
})
