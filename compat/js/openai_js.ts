// OpenAI JS SDK vs plugboard, scenarios S1-S7 + extras. Run: cd compat/js && bun openai_js.ts [S1,S2,...]
// Env: PLUGBOARD_BASE_URL (default http://127.0.0.1:4010/v1), PLUGBOARD_KEY (required).
import OpenAI from "openai"
import { zodResponseFormat } from "openai/helpers/zod"
import { z } from "zod"
import { readFileSync } from "node:fs"

const baseURL = process.env.PLUGBOARD_BASE_URL ?? "http://127.0.0.1:4010/v1"
const apiKey = process.env.PLUGBOARD_KEY
if (!apiKey) throw new Error("set PLUGBOARD_KEY")
const fx = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8")
const client = new OpenAI({ baseURL, apiKey, maxRetries: 0 })

const tool = JSON.parse(fx("get_weather.tool.json"))
const toolResult = fx("get_weather.result.json").trim()
const schemaFx = JSON.parse(fx("meal_estimate.json_schema.json"))
const redUrl = fx("red32.dataurl.txt").trim()

const FAST = "fast"
const CLAUDE = "anthropic/claude-haiku-4-5"
const GPT = "openai/gpt-5.6-luna#low"
const WEATHER = "What is the weather in Paris? Use the tool."

type Row = { id: string; model: string; ok: boolean; note: string }
const rows: Row[] = []
async function run(id: string, model: string, fn: () => Promise<string>) {
  const want = process.argv[2]
  if (want && !want.split(",").includes(id)) return
  try {
    const note = await fn()
    rows.push({ id, model, ok: true, note })
  } catch (e: any) {
    rows.push({ id, model, ok: false, note: `${e?.constructor?.name}: ${e?.message}` })
  }
  const r = rows[rows.length - 1]!
  console.log(`${r.ok ? "PASS" : "FAIL"} ${id} ${model} :: ${r.note}`)
}
function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(`assert: ${m}`)
}

// S1
async function s1(model: string) {
  const r = await client.chat.completions.create({ model, messages: [{ role: "user", content: "Reply with exactly: pong" }] })
  const c = r.choices[0]!
  assert(/pong/i.test(c.message.content ?? ""), `content ${JSON.stringify(c.message.content)}`)
  assert(c.finish_reason === "stop", `finish ${c.finish_reason}`)
  assert(r.usage && r.usage.prompt_tokens != null && r.usage.completion_tokens != null && r.usage.total_tokens != null, "usage")
  return `finish=${c.finish_reason} usage=${JSON.stringify(r.usage)}`
}

// S2
async function s2(model: string) {
  const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "user", content: WEATHER }]
  const r1 = await client.chat.completions.create({ model, messages, tools: [tool] })
  const c1 = r1.choices[0]!
  assert(c1.finish_reason === "tool_calls", `t1 finish ${c1.finish_reason}`)
  const tcs = c1.message.tool_calls ?? []
  assert(tcs.length === 1, `tool_calls ${tcs.length}`)
  const tc = tcs[0]! as any
  assert(tc.function.name === "get_weather" && tc.id, "name/id")
  const args = JSON.parse(tc.function.arguments)
  assert(/paris/i.test(args.city), `city ${args.city}`)
  messages.push(c1.message as any, { role: "tool", tool_call_id: tc.id, content: toolResult })
  const r2 = await client.chat.completions.create({ model, messages, tools: [tool] })
  const c2 = r2.choices[0]!
  assert(c2.finish_reason === "stop", `t2 finish ${c2.finish_reason}`)
  assert(/18|cloud/i.test(c2.message.content ?? ""), `t2 content ${c2.message.content}`)
  return `t1 id=${tc.id} args=${tc.function.arguments}; t2 ${JSON.stringify(c2.message.content)}`
}

// S3
async function s3(model: string) {
  const out: string[] = []
  for (const include_usage of [false, true]) {
    const stream = await client.chat.completions.create({
      model,
      stream: true,
      ...(include_usage ? { stream_options: { include_usage: true } } : {}),
      messages: [{ role: "user", content: "Reply with exactly: pong" }],
    })
    let text = "", first: any, finish: any, usage: any, n = 0, lastChoices = -1
    for await (const ch of stream) {
      n++
      if (n === 1) first = ch.choices[0]?.delta
      text += ch.choices[0]?.delta?.content ?? ""
      if (ch.choices[0]?.finish_reason) finish = ch.choices[0].finish_reason
      if (ch.usage) usage = ch.usage
      lastChoices = ch.choices.length
      assert(ch.object === "chat.completion.chunk", `object ${ch.object}`)
    }
    assert(first?.role === "assistant", `first role ${JSON.stringify(first)}`)
    assert(/pong/i.test(text), `text ${text}`)
    assert(finish === "stop", `finish ${finish}`)
    if (include_usage) assert(usage && lastChoices === 0, `usage ${JSON.stringify(usage)} lastChoices=${lastChoices}`)
    out.push(`usage=${include_usage} chunks=${n} text=${JSON.stringify(text)} finish=${finish}${include_usage ? " u=" + JSON.stringify(usage) : ""}`)
  }
  return out.join(" | ")
}

// S4 (raw for-await + helper .stream() + finalChatCompletion + runTools)
async function s4(model: string) {
  const out: string[] = []
  const stream = await client.chat.completions.create({
    model, stream: true, stream_options: { include_usage: true },
    messages: [{ role: "user", content: WEATHER }], tools: [tool],
  })
  const calls = new Map<number, { id?: string; type?: string; name: string; args: string }>()
  let finish: any, usage: any, deltaCount = 0
  for await (const ch of stream) {
    for (const t of ch.choices[0]?.delta?.tool_calls ?? []) {
      deltaCount++
      const cur = calls.get(t.index) ?? { name: "", args: "" }
      if (t.id) cur.id = t.id
      if (t.type) cur.type = t.type
      cur.name += t.function?.name ?? ""
      cur.args += t.function?.arguments ?? ""
      calls.set(t.index, cur)
    }
    if (ch.choices[0]?.finish_reason) finish = ch.choices[0].finish_reason
    if (ch.usage) usage = ch.usage
  }
  assert(finish === "tool_calls", `finish ${finish}`)
  assert(calls.size === 1 && calls.get(0)!.name === "get_weather" && calls.get(0)!.id && calls.get(0)!.type === "function", JSON.stringify([...calls]))
  assert(/paris/i.test(JSON.parse(calls.get(0)!.args).city), `args ${calls.get(0)!.args}`)
  assert(usage, "usage")
  out.push(`raw: deltas=${deltaCount} args=${calls.get(0)!.args}`)

  // helper
  const s = client.chat.completions.stream({ model, stream_options: { include_usage: true } as any, messages: [{ role: "user", content: WEATHER }], tools: [tool] } as any)
  let events = 0
  s.on("tool_calls.function.arguments.done" as any, () => events++)
  const fin = await s.finalChatCompletion()
  const m = fin.choices[0]!
  assert(m.finish_reason === "tool_calls", `helper finish ${m.finish_reason}`)
  const tcs = m.message.tool_calls as any[]
  assert(tcs?.length === 1 && tcs[0].function.name === "get_weather" && tcs[0].id && /paris/i.test(JSON.parse(tcs[0].function.arguments).city), `helper tool_calls ${JSON.stringify(tcs)}`)
  out.push(`helper: id=${tcs[0].id} args=${tcs[0].function.arguments} argsDoneEvents=${events} usage=${JSON.stringify(fin.usage)}`)

  // runTools
  let called: any = null
  const rt = client.chat.completions.runTools({
    model,
    messages: [{ role: "user", content: WEATHER }],
    tools: [{
      type: "function",
      function: {
        name: "get_weather",
        description: tool.function.description,
        parameters: tool.function.parameters,
        parse: JSON.parse,
        function: (a: any) => { called = a; return JSON.parse(toolResult) },
      },
    }],
  })
  const final = await rt.finalContent()
  assert(called && /paris/i.test(called.city), `runTools called ${JSON.stringify(called)}`)
  assert(/18|cloud/i.test(final ?? ""), `runTools final ${final}`)
  out.push(`runTools: called=${JSON.stringify(called)} final=${JSON.stringify(final)}`)
  return out.join(" | ")
}

// S5
async function s5(model: string) {
  const r = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: [
      { type: "text", text: "What color is this image? One word." },
      { type: "image_url", image_url: { url: redUrl } },
    ] }],
  })
  const c = r.choices[0]!.message.content ?? ""
  assert(/red/i.test(c), `content ${JSON.stringify(c)}`)
  return JSON.stringify(c)
}

// S6
const Meal = z.object({ calories: z.number(), protein_g: z.number() })
function checkMeal(content: string | null | undefined) {
  const j = JSON.parse(content ?? "")
  assert(typeof j.calories === "number" && typeof j.protein_g === "number", `types ${content}`)
  assert(Object.keys(j).sort().join() === "calories,protein_g", `keys ${content}`)
  return content!
}
async function s6(model: string) {
  const out: string[] = []
  const prompt = "Estimate: 2 boiled eggs and a slice of toast."
  const r = await client.chat.completions.create({
    model, messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_schema", json_schema: schemaFx },
  })
  out.push("raw: " + checkMeal(r.choices[0]!.message.content))
  // zodResponseFormat + parse
  try {
    const p = await client.chat.completions.parse({
      model, messages: [{ role: "user", content: prompt }],
      response_format: zodResponseFormat(Meal, "meal_estimate"),
    })
    const parsed = p.choices[0]!.message.parsed
    assert(parsed && typeof parsed.calories === "number" && typeof parsed.protein_g === "number", `parsed ${JSON.stringify(parsed)}`)
    out.push("parse: " + JSON.stringify(parsed))
  } catch (e: any) { out.push(`parse FAILED: ${e?.constructor?.name}: ${e?.message}`); throw new Error(out.join(" | ")) }
  // stream helper + structured
  try {
    const s = client.chat.completions.stream({
      model, messages: [{ role: "user", content: prompt }],
      response_format: zodResponseFormat(Meal, "meal_estimate"),
    })
    const fin = await s.finalChatCompletion()
    out.push("stream+zod content: " + (fin.choices[0]!.message.content ?? "").slice(0, 80))
    checkMeal(fin.choices[0]!.message.content)
  } catch (e: any) { out.push(`stream+zod FAILED: ${e?.constructor?.name}: ${e?.message}`); throw new Error(out.join(" | ")) }
  return out.join(" | ")
}

// S7
async function s7() {
  const ids: string[] = []
  let n = 0
  for await (const m of client.models.list()) { n++; ids.push(m.id) }
  const dups = n - new Set(ids).size
  assert(ids.includes(FAST), "no fast")
  assert(ids.some((i) => i.startsWith("anthropic/claude")), "no claude")
  assert(ids.some((i) => i.endsWith("#low")), "no #low")
  const page = await client.models.list()
  const first = page.data[0] as any
  return `count=${n} unique=${new Set(ids).size} dups=${dups} firstKeys=${Object.keys(first)} created=${first.created}`
}

// extras
async function errors() {
  const out: string[] = []
  try {
    await client.chat.completions.create({ model: FAST, messages: [{ role: "user", content: "hi" }] }, {})
  } catch {}
  const bad = new OpenAI({ baseURL, apiKey: "wrong", maxRetries: 0 })
  try { await bad.chat.completions.create({ model: FAST, messages: [{ role: "user", content: "hi" }] }); assert(false, "no error") }
  catch (e: any) {
    assert(e instanceof OpenAI.AuthenticationError, `class ${e?.constructor?.name}`)
    out.push(`401: ${e.constructor.name} status=${e.status} code=${e.code} type=${e.type} msg=${e.message}`)
  }
  try { await bad.models.list(); assert(false, "no error") }
  catch (e: any) {
    assert(e instanceof OpenAI.AuthenticationError, `models class ${e?.constructor?.name}`)
    out.push(`401 models: ${e.constructor.name} code=${e.code}`)
  }
  try { await client.chat.completions.create({ model: "nope", messages: [{ role: "user", content: "hi" }] }); assert(false, "no error") }
  catch (e: any) {
    assert(e instanceof OpenAI.NotFoundError, `class ${e?.constructor?.name}`)
    out.push(`404: ${e.constructor.name} status=${e.status} code=${e.code} type=${e.type} param=${e.param} msg=${e.message}`)
  }
  try {
    const s = await client.chat.completions.create({ model: "nope", stream: true, messages: [{ role: "user", content: "hi" }] })
    for await (const _ of s) {}
    assert(false, "no error")
  } catch (e: any) {
    assert(e instanceof OpenAI.NotFoundError, `stream class ${e?.constructor?.name}`)
    out.push(`404 stream: ${e.constructor.name} status=${e.status} code=${e.code}`)
  }
  return out.join(" | ")
}

async function extras(model: string) {
  const out: string[] = []
  const r = await client.chat.completions.create({
    model,
    messages: [{ role: "developer", content: "Answer tersely." }, { role: "user", content: "Reply with exactly: pong" }],
    max_completion_tokens: 256,
    reasoning_effort: "low",
  })
  out.push(`developer+max_completion_tokens+reasoning_effort: ${JSON.stringify(r.choices[0]!.message.content)} finish=${r.choices[0]!.finish_reason}`)
  return out.join(" | ")
}

await run("S1", FAST, () => s1(FAST))
await run("S1", CLAUDE, () => s1(CLAUDE))
await run("S1", GPT, () => s1(GPT))
await run("S2", FAST, () => s2(FAST))
await run("S2", CLAUDE, () => s2(CLAUDE))
await run("S2", GPT, () => s2(GPT))
await run("S3", FAST, () => s3(FAST))
await run("S4", FAST, () => s4(FAST))
await run("S5", FAST, () => s5(FAST))
await run("S5", CLAUDE, () => s5(CLAUDE))
await run("S5", GPT, () => s5(GPT))
await run("S6", FAST, () => s6(FAST))
await run("S6", CLAUDE, () => s6(CLAUDE))
await run("S6", GPT, () => s6(GPT))
await run("S7", "n/a", s7)
await run("ERR", "n/a", errors)
await run("EXTRA", FAST, () => extras(FAST))

console.log("\nSUMMARY")
for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"}\t${r.id}\t${r.model}`)
const failed = rows.filter((r) => !r.ok)
console.log(`${failed.length} of ${rows.length} failed`)
if (failed.length > 0) process.exit(1)
