// Vercel AI SDK (ai v7) compat run against plugboard. Scenarios S1-S7.
// Usage: cd compat/js && bun vercel_ai.ts <compat|openai-chat|openai-default> [S1,S2,...] [model,model]
// Env: PLUGBOARD_BASE_URL (default http://127.0.0.1:4010/v1), PLUGBOARD_KEY (default: key file).
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenAI } from "@ai-sdk/openai"
import { generateText, streamText, generateObject, tool, isStepCount, Output } from "ai"
import { z } from "zod"
import { homedir } from "node:os"
import { readFileSync } from "node:fs"

const baseURL = process.env.PLUGBOARD_BASE_URL ?? "http://127.0.0.1:4010/v1"
const apiKey = process.env.PLUGBOARD_KEY ?? readFileSync(`${homedir()}/.cache/opencode-adapter-dev/.compat-key`, "utf8").trim()
const providerKind = process.argv[2] ?? "compat"
const only = process.argv[3] && process.argv[3] !== "all" ? process.argv[3].split(",") : null
const modelsArg = process.argv[4]?.split(",")
const FAST = "fast", CLAUDE = "anthropic/claude-haiku-4-5", GPT = "openai/gpt-5.6-luna#low"
const redUrl = readFileSync("../fixtures/red32.dataurl.txt", "utf8").trim()

// Request log: what the SDK actually sends (key never recorded).
type Sent = { url: string; body: any }
let sent: Sent[] = []
const loggingFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  let body: any = undefined
  try { body = init?.body ? JSON.parse(String(init.body)) : undefined } catch { body = String(init?.body) }
  sent.push({ url, body })
  return fetch(input, init)
}

function provider(opts: { includeUsage?: boolean; structured?: boolean } = {}) {
  if (providerKind === "compat")
    return createOpenAICompatible({ name: "plugboard", baseURL, apiKey, fetch: loggingFetch, includeUsage: opts.includeUsage, supportsStructuredOutputs: opts.structured })
  const oa = createOpenAI({ baseURL, apiKey, fetch: loggingFetch })
  return { chatModel: (m: string) => (providerKind === "openai-chat" ? oa.chat(m) : oa(m)) } as any
}
const model = (m: string, o: Parameters<typeof provider>[0] = {}) => {
  const p: any = provider(o)
  return providerKind === "compat" ? p.chatModel(m) : p.chatModel(m)
}

const summarize = (s: Sent) => {
  const b = s.body ?? {}
  const keys = Object.keys(b)
  const parts: string[] = [s.url.replace(baseURL, "")]
  parts.push("keys=" + keys.join(","))
  if (b.messages) parts.push("roles=" + b.messages.map((m: any) => m.role).join(">"))
  if (b.input) parts.push("input[]=" + (Array.isArray(b.input) ? b.input.map((m: any) => m.role ?? m.type).join(">") : "str"))
  for (const k of ["max_tokens", "max_completion_tokens", "max_output_tokens", "stream", "stream_options", "response_format", "tool_choice", "parallel_tool_calls", "reasoning_effort", "temperature", "store"])
    if (k in b) parts.push(`${k}=${JSON.stringify(b[k])}`)
  return parts.join(" | ")
}
const dumpSent = () => { for (const s of sent) console.log("   SENT:", summarize(s)) }
const dumpSentFull = () => { for (const s of sent) console.log("   SENT-FULL:", JSON.stringify(s.body).slice(0, 1500)) }

const weather = tool({
  description: "Current weather for a city",
  inputSchema: z.object({ city: z.string().describe("City name") }),
  execute: async ({ city }) => { toolCalls.push(city); return JSON.parse(readFileSync("../fixtures/get_weather.result.json", "utf8")) },
})
let toolCalls: string[] = []
const Meal = z.object({ calories: z.number(), protein_g: z.number() })
const mealOk = (o: any) => o && typeof o.calories === "number" && typeof o.protein_g === "number" && Object.keys(o).sort().join() === "calories,protein_g"

type R = { ok: boolean; note: string }
const scenarios: Record<string, (m: string) => Promise<R>> = {
  async S1(m) {
    const r = await generateText({ model: model(m), prompt: "Reply with exactly: pong" })
    const ok = /pong/i.test(r.text) && r.finishReason === "stop" && !!r.usage.totalTokens
    return { ok, note: `text=${JSON.stringify(r.text)} finish=${r.finishReason} usage=${JSON.stringify({ in: r.usage.inputTokens, out: r.usage.outputTokens, total: r.usage.totalTokens })} resp.id=${r.response.id} resp.modelId=${r.response.modelId}` }
  },
  async S2(m) {
    toolCalls = []
    const r = await generateText({ model: model(m), tools: { get_weather: weather }, stopWhen: isStepCount(4), prompt: "What is the weather in Paris? Use the tool." })
    const steps = r.steps.map((s) => s.finishReason).join(">")
    const ok = toolCalls.length === 1 && /paris/i.test(toolCalls[0]) && /18|cloud/i.test(r.text) && r.finishReason === "stop"
    return { ok, note: `steps=${steps} toolCityArg=${JSON.stringify(toolCalls)} finalText=${JSON.stringify(r.text.slice(0, 120))} step1.toolCalls=${JSON.stringify(r.steps[0]?.toolCalls.map((c) => ({ id: c.toolCallId, name: c.toolName, input: c.input })))}` }
  },
  async S3(m) {
    const out: string[] = []
    const types: string[] = []
    for (const includeUsage of [true, false]) {
      const r = streamText({ model: model(m, { includeUsage }), prompt: "Reply with exactly: pong" })
      let text = "", finish = "", usage: any
      for await (const p of r.fullStream) {
        types.push(p.type)
        if (p.type === "text-delta") text += (p as any).text ?? (p as any).delta
        if (p.type === "finish") { finish = (p as any).finishReason; usage = (p as any).totalUsage }
        if (p.type === "error") throw new Error("stream error part: " + JSON.stringify((p as any).error))
      }
      out.push(`includeUsage=${includeUsage}: text=${JSON.stringify(text)} finish=${finish} usage=${JSON.stringify({ in: usage?.inputTokens, out: usage?.outputTokens, total: usage?.totalTokens })}`)
      if (!/pong/i.test(text) || finish !== "stop") return { ok: false, note: out.join(" ;; ") }
    }
    return { ok: true, note: out.join(" ;; ") + ` parts=${[...new Set(types)].join(",")}` }
  },
  async S4(m) {
    toolCalls = []
    // No execute -> SDK should hand back assembled tool calls without running anything.
    const noExec = tool({ description: "Current weather for a city", inputSchema: z.object({ city: z.string() }) })
    const r = streamText({ model: model(m, { includeUsage: true }), tools: { get_weather: noExec }, prompt: "What is the weather in Paris? Use the tool." })
    const parts: string[] = []
    let call: any, finish = "", usage: any
    for await (const p of r.fullStream) {
      parts.push(p.type)
      if (p.type === "tool-call") call = p
      if (p.type === "finish") { finish = (p as any).finishReason; usage = (p as any).totalUsage }
      if (p.type === "error") throw new Error("stream error part: " + JSON.stringify((p as any).error))
    }
    const ok = !!call && call.toolName === "get_weather" && /paris/i.test(call.input?.city ?? "") && !!call.toolCallId && finish === "tool-calls"
    return { ok, note: `call=${JSON.stringify({ id: call?.toolCallId, name: call?.toolName, input: call?.input })} finish=${finish} usage.total=${usage?.totalTokens} parts=${[...new Set(parts)].join(",")}` }
  },
  async S5(m) {
    const r = await generateText({ model: model(m), messages: [{ role: "user", content: [{ type: "text", text: "What color is this image? One word." }, { type: "image", image: redUrl }] }] })
    return { ok: /red/i.test(r.text), note: `text=${JSON.stringify(r.text)} finish=${r.finishReason}` }
  },
  async S6(m) {
    const notes: string[] = []
    let ok = true
    // (a) Output.object via generateText
    const a = await generateText({ model: model(m), output: Output.object({ schema: Meal }), prompt: "Estimate: 2 boiled eggs and a slice of toast." })
    notes.push(`Output.object: ${JSON.stringify(a.output)} ${mealOk(a.output) ? "ok" : "BAD"}`)
    ok &&= mealOk(a.output)
    // (b) generateObject (default provider settings)
    const b = await generateObject({ model: model(m), schema: Meal, prompt: "Estimate: 2 boiled eggs and a slice of toast." })
    notes.push(`generateObject: ${JSON.stringify(b.object)} ${mealOk(b.object) ? "ok" : "BAD"}`)
    ok &&= mealOk(b.object)
    return { ok, note: notes.join(" ;; ") }
  },
  async S6s(m) { // compat only: supportsStructuredOutputs:true -> json_schema response_format
    const a = await generateText({ model: model(m, { structured: true }), output: Output.object({ schema: Meal }), prompt: "Estimate: 2 boiled eggs and a slice of toast." })
    const b = await generateObject({ model: model(m, { structured: true }), schema: Meal, prompt: "Estimate: 2 boiled eggs and a slice of toast." })
    return { ok: mealOk(a.output) && mealOk(b.object), note: `Output.object: ${JSON.stringify(a.output)} ;; generateObject: ${JSON.stringify(b.object)}` }
  },
  async S7() {
    const res = await fetch(baseURL + "/models", { headers: { authorization: `Bearer ${apiKey}` } })
    const j: any = await res.json()
    const ids: string[] = j.data.map((d: any) => d.id)
    return { ok: res.status === 200 && ids.includes("fast"), note: `(n.a. in SDK; raw fetch) status=${res.status} n=${ids.length} fast=${ids.includes("fast")} claude=${ids.includes(CLAUDE)} low=${ids.includes(GPT)} dupes=${ids.length - new Set(ids).size}` }
  },
  async E1() { // error paths
    const out: string[] = []
    try { await generateText({ model: model("nope"), prompt: "hi", maxRetries: 0 }) } catch (e: any) { out.push(`model nope: ${e.constructor.name} status=${e.statusCode} msg=${JSON.stringify(e.message)} body=${JSON.stringify(e.responseBody)?.slice(0, 300)}`) }
    const bad = createOpenAICompatible({ name: "plugboard", baseURL, apiKey: "wrong", fetch: loggingFetch })
    try { await generateText({ model: bad.chatModel("fast"), prompt: "hi", maxRetries: 0 }) } catch (e: any) { out.push(`wrong key: ${e.constructor.name} status=${e.statusCode} msg=${JSON.stringify(e.message)} body=${JSON.stringify(e.responseBody)?.slice(0, 300)}`) }
    return { ok: out.length === 2, note: out.join(" ;; ") }
  },
  async E2() { // system prompt + maxOutputTokens + reasoning effort + default sampling fields
    const r = await generateText({ model: model(FAST), system: "You answer in one word.", prompt: "Say pong.", maxOutputTokens: 200, temperature: 0.2, providerOptions: { plugboard: { reasoningEffort: "low" }, openai: { reasoningEffort: "low" } } })
    return { ok: r.finishReason === "stop", note: `text=${JSON.stringify(r.text)} finish=${r.finishReason}` }
  },
}

const defaultPlan: [string, string[]][] = [
  ["S1", [FAST, CLAUDE, GPT]], ["S2", [FAST, CLAUDE, GPT]], ["S3", [FAST]], ["S4", [FAST]],
  ["S5", [FAST, CLAUDE, GPT]], ["S6", [FAST, CLAUDE, GPT]], ["S7", [FAST]],
]
const extra: [string, string[]][] = [["S6s", [FAST]], ["E1", [FAST]], ["E2", [FAST]]]

console.log(`provider=${providerKind} baseURL=${baseURL}`)
const table: string[] = []
for (const [sc, models] of [...defaultPlan, ...extra]) {
  if (only ? !only.includes(sc) : false) continue
  if (!only && extra.some((e) => e[0] === sc) && process.env.NO_EXTRA) continue
  if (sc === "S6s" && providerKind !== "compat") continue
  for (const m of modelsArg ?? models) {
    if (modelsArg && !models.includes(m) && !modelsArg.includes(m)) continue
    sent = []
    const t0 = Date.now()
    let r: R
    try { r = await scenarios[sc](m) } catch (e: any) {
      r = { ok: false, note: `THROW ${e?.constructor?.name} status=${e?.statusCode} msg=${JSON.stringify(e?.message)} body=${JSON.stringify(e?.responseBody)?.slice(0, 500)}` }
    }
    console.log(`\n[${sc}] ${m} => ${r.ok ? "PASS" : "FAIL"} (${Date.now() - t0}ms)\n   ${r.note}`)
    dumpSent()
    if (process.env.FULL || !r.ok) dumpSentFull()
    table.push(`${sc}\t${m}\t${r.ok ? "pass" : "FAIL"}`)
  }
}
console.log("\n" + table.join("\n"))
