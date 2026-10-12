/**
 * The examples harness normaliser and writer (examples/_harness/normalise.ts, render.ts). Each test names the rule
 * it protects; the rules are the Contract's "Normalising and redaction" section in issue #174.
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Exchange } from "../../examples/_harness/capture.ts"
import { canonicalJson, normaliseTranscript, parseFrames, redactPath } from "../../examples/_harness/normalise.ts"
import { verdictOf, writeRun, type RunSummary, type ScenarioRow } from "../../examples/_harness/render.ts"

const exchange = (overrides: Partial<Exchange>): Exchange => ({
  seq: 0,
  mark: 0,
  method: "POST",
  path: "/v1/chat/completions",
  reqHeaders: { "content-type": "application/json", authorization: "Bearer sk-secret-app-key" },
  reqBody: "{}",
  status: 200,
  resHeaders: { "content-type": "application/json", "x-plugboard-request-id": "req_abc123", "x-plugboard-app": "compat", date: "Mon, 12 Oct 2026 00:00:00 GMT" },
  resBody: "{}",
  durationMs: 1,
  ...overrides,
})

describe("placeholders for ids", () => {
  test("a turn-1 call id equals turn-2's tool_call_id within one file", () => {
    const turn1 = exchange({
      seq: 0,
      resBody: JSON.stringify({ id: "chatcmpl-AAA111", choices: [{ message: { tool_calls: [{ id: "call_9f8e7d", type: "function" }] } }] }),
    })
    const turn2 = exchange({
      seq: 1,
      reqBody: JSON.stringify({ messages: [{ role: "tool", tool_call_id: "call_9f8e7d", content: "{}" }] }),
    })
    const { exchanges } = normaliseTranscript([turn1, turn2])
    const callId = (exchanges[0]!.response.body as { choices: Array<{ message: { tool_calls: Array<{ id: string }> } }> }).choices[0]!.message.tool_calls[0]!.id
    const toolCallId = (exchanges[1]!.request.body as { messages: Array<{ tool_call_id: string }> }).messages[0]!.tool_call_id
    // Numbering follows sorted keys, so `choices` (and its call id) is seen before the top-level `id`.
    expect(callId).toMatch(/^<id-\d+>$/)
    expect(toolCallId).toBe(callId)
  })

  test("placeholders are numbered by first appearance in each file, so two files start at <id-1>", () => {
    const first = normaliseTranscript([exchange({ resBody: JSON.stringify({ id: "msg_one" }) })])
    const second = normaliseTranscript([exchange({ resBody: JSON.stringify({ id: "msg_two" }) })])
    expect((first.exchanges[0]!.response.body as { id: string }).id).toBe("<id-1>")
    expect((second.exchanges[0]!.response.body as { id: string }).id).toBe("<id-1>")
  })

  test("Gemini's unprefixed responseId is replaced under its key, so two runs match", () => {
    const { exchanges } = normaliseTranscript([exchange({ resBody: JSON.stringify({ candidates: [], responseId: "cc8873367ce847bb8995d5" }) })])
    expect(exchanges[0]!.response.body).toEqual({ candidates: [], responseId: "<id-1>" })
  })

  test("two equal timestamps in one file are two placeholders, so a second boundary does not change the file", () => {
    const same = JSON.stringify({ created: 1791749771 })
    const { exchanges } = normaliseTranscript([exchange({ resBody: same, seq: 0 }), exchange({ resBody: same, seq: 1 })])
    expect(exchanges.map((item) => (item.response.body as { created: string }).created)).toEqual(["<time-1>", "<time-2>"])
  })

  test("a UUID inside a string is replaced by pattern, not only under an id key", () => {
    const { exchanges } = normaliseTranscript([exchange({ resBody: JSON.stringify({ error: "request 1f2e3d4c-0000-4000-8000-123456789abc failed" }) })])
    expect(exchanges[0]!.response.body).toEqual({ error: "request <id-1> failed" })
  })

  test("model ids on a GET of a models route are names and stay as they are", () => {
    const list = exchange({
      method: "GET",
      path: "/v1/models",
      reqBody: "",
      resBody: JSON.stringify({ object: "list", data: [{ id: "fast", object: "model", created: 0 }, { id: "anthropic/claude-haiku-4-5", object: "model", created: 0 }] }),
    })
    const body = normaliseTranscript([list]).exchanges[0]!.response.body as { data: Array<{ id: string; created: number }> }
    expect(body.data.map((model) => model.id)).toEqual(["fast", "anthropic/claude-haiku-4-5"])
    expect(body.data[0]!.created).toBe(0)
  })
})

describe("URLs, headers and secrets", () => {
  test("the loopback plugboard URL becomes <plugboard>, error text included", () => {
    const { exchanges } = normaliseTranscript([exchange({ resBody: JSON.stringify({ error: { message: "upstream http://127.0.0.1:52231/v1 refused" } }) })])
    expect(exchanges[0]!.response.body).toEqual({ error: { message: "upstream <plugboard>/v1 refused" } })
  })

  test("only allow-listed request headers survive; the bearer key never does", () => {
    const { exchanges } = normaliseTranscript([
      exchange({ reqHeaders: { authorization: "Bearer sk-secret-app-key", "x-api-key": "sk-secret-app-key", "content-type": "application/json", "user-agent": "OpenAI/Python", "x-stainless-os": "MacOS" } }),
    ])
    expect(exchanges[0]!.request.headers).toEqual({ "content-type": "application/json" })
  })

  test("x-plugboard-* response headers are kept except the request id; date is never kept", () => {
    const { exchanges } = normaliseTranscript([exchange({})])
    expect(exchanges[0]!.response.headers).toEqual({ "content-type": "application/json", "x-plugboard-app": "compat" })
  })

  test("the key query parameter is removed and the rest of the target is kept", () => {
    expect(redactPath("/v1beta/models/fast:generateContent?key=sk-secret&alt=sse")).toBe("/v1beta/models/fast:generateContent?alt=sse")
    expect(redactPath("/v1beta/models/fast:generateContent?key=sk-secret")).toBe("/v1beta/models/fast:generateContent")
  })
})

describe("SSE and files", () => {
  test("parsed frames carry data as JSON, keep [DONE], and drop keepalive comments", () => {
    const frames = parseFrames(': keepalive\n\ndata: {"choices":[{"delta":{"content":"pong"}}]}\n\ndata: [DONE]\n\n')
    expect(frames).toEqual([{ data: { choices: [{ delta: { content: "pong" } }] } }, { data: "[DONE]" }])
  })

  test("canonical JSON sorts keys at every depth, indents two spaces and ends with a newline", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe('{\n  "a": {\n    "c": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ],\n    "d": 2\n  },\n  "b": 1\n}\n')
  })
})

describe("writer", () => {
  const row = (status: ScenarioRow["status"], required = true): ScenarioRow => ({ id: "S1", model: "fast", required, status, checks: [], note: null, error: null, transcript: null })
  const summary = (secretBody: string): RunSummary => ({
    schema: 1,
    example: "unit",
    target: "scripted",
    client: { name: "unit", version: "1.0.0", runtime: { name: "bun", version: "1.4" } },
    models: ["fast"],
    verdict: "pass",
    scenarios: [{ id: "S1", model: "fast", required: true, status: "pass", checks: [], note: null, error: secretBody, transcript: "transcripts/S1.fast.json" }],
  })

  test("a summary whose transcript carries the app key is refused, and nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plugboard-examples-"))
    try {
      const transcripts = { "S1.fast.json": normaliseTranscript([exchange({ resBody: JSON.stringify({ leaked: "sk-secret-app-key" }) })]) }
      await expect(writeRun({ dir, summary: summary("ok"), transcripts, secret: "sk-secret-app-key", replaceTranscripts: false })).rejects.toThrow(/app key appears/)
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a verdict fails on a required failure and is partial on a gap or an optional failure", () => {
    expect(verdictOf([row("fail")])).toBe("fail")
    expect(verdictOf([row("gap")])).toBe("partial")
    expect(verdictOf([row("fail", false)])).toBe("partial")
    expect(verdictOf([row("pass"), row("n/a")])).toBe("pass")
  })
})
