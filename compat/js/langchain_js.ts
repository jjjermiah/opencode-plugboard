// LangChain JS (@langchain/openai) compat run against plugboard. Run: cd compat/js && bun langchain_js.ts [S1 S2 ...]
import { readFileSync } from "node:fs";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

const BASE = process.env.PLUGBOARD_BASE_URL ?? "http://127.0.0.1:4010/v1";
const KEY = process.env.PLUGBOARD_KEY;
if (!KEY) throw new Error("set PLUGBOARD_KEY");
const FIX = new URL("../fixtures/", import.meta.url).pathname;
// JS ChatOpenAI forces the Responses API for any model id containing "gpt-5.6" (utils/misc.js _modelPrefersResponsesAPI),
// ignoring useResponsesApi:false, so openai/gpt-5.6-luna#low 404s on /v1/responses. GPT_ALT dodges that rule.
const GPT_ALT = "openai/gpt-5.5#low";
const FAST = "fast", CLAUDE = "anthropic/claude-haiku-4-5", GPT = "openai/gpt-5.6-luna#low";
const RED = readFileSync(FIX + "red32.dataurl.txt", "utf8").trim();
const TOOL_RESULT = readFileSync(FIX + "get_weather.result.json", "utf8").trim();
const PW = "What is the weather in Paris? Use the tool.";

const llm = (model: string, extra: Record<string, unknown> = {}) =>
  new ChatOpenAI({ model, apiKey: KEY, configuration: { baseURL: BASE }, useResponsesApi: false, maxRetries: 0, ...extra });

const getWeather = tool(async () => TOOL_RESULT, {
  name: "get_weather",
  description: "Get the current weather for a city.",
  schema: z.object({ city: z.string() }),
});
const Meal = z.object({ calories: z.number(), protein_g: z.number() }).describe("Meal nutrition estimate.");

const show = (m: any) => {
  console.log("  content:", JSON.stringify(m.content).slice(0, 200));
  console.log("  tool_calls:", JSON.stringify(m.tool_calls));
  console.log("  usage_metadata:", JSON.stringify(m.usage_metadata));
  console.log("  response_metadata:", JSON.stringify(m.response_metadata).slice(0, 300));
};
const assert = (c: unknown, msg: string) => { if (!c) throw new Error("assert: " + msg); };
const text = (m: any) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));

async function s1(model: string) {
  const m = await llm(model).invoke("Reply with exactly: pong");
  show(m);
  assert(text(m).toLowerCase().includes("pong"), "pong");
  assert((m.response_metadata as any).finish_reason === "stop", "finish stop");
  assert(m.usage_metadata?.total_tokens, "usage");
}
async function s2(model: string) {
  const b = llm(model).bindTools([getWeather]);
  const hist: any[] = [new HumanMessage(PW)];
  const m = await b.invoke(hist);
  show(m);
  assert((m.response_metadata as any).finish_reason === "tool_calls", "finish tool_calls");
  const call = m.tool_calls?.[0];
  assert(m.tool_calls?.length === 1 && call?.name === "get_weather" && call.id, "tool call");
  assert(JSON.stringify(call!.args).toLowerCase().includes("paris"), "paris");
  hist.push(m, new ToolMessage({ content: TOOL_RESULT, tool_call_id: call!.id! }));
  const m2 = await b.invoke(hist);
  console.log(" turn2:"); show(m2);
  assert((m2.response_metadata as any).finish_reason === "stop", "turn2 stop");
  assert(/18|cloudy/i.test(text(m2)), "turn2 content");
}
async function s3(model: string) {
  const chunks: any[] = [];
  for await (const c of await llm(model, { streamUsage: true }).stream("Reply with exactly: pong")) chunks.push(c);
  const t = chunks.map(text).join("");
  console.log("  n chunks:", chunks.length, "text:", JSON.stringify(t));
  let agg = chunks[0]; for (const c of chunks.slice(1)) agg = agg.concat(c);
  console.log("  agg usage:", JSON.stringify(agg.usage_metadata), "| resp_meta:", JSON.stringify(agg.response_metadata));
  assert(t.toLowerCase().includes("pong"), "pong");
  assert(agg.response_metadata.finish_reason === "stop", "finish");
  assert(agg.usage_metadata?.total_tokens, "usage");
}
async function s4(model: string) {
  const b = llm(model, { streamUsage: true }).bindTools([getWeather]);
  const chunks: any[] = [];
  for await (const c of await b.stream(PW)) chunks.push(c);
  chunks.forEach((c, i) => c.tool_call_chunks?.length && console.log("  chunk", i, JSON.stringify(c.tool_call_chunks)));
  let agg = chunks[0]; for (const c of chunks.slice(1)) agg = agg.concat(c);
  console.log("  agg tool_calls:", JSON.stringify(agg.tool_calls), "invalid:", JSON.stringify(agg.invalid_tool_calls));
  console.log("  usage:", JSON.stringify(agg.usage_metadata), "| resp_meta:", JSON.stringify(agg.response_metadata));
  assert(agg.tool_calls.length === 1 && agg.tool_calls[0].name === "get_weather", "tool call");
  assert(JSON.stringify(agg.tool_calls[0].args).toLowerCase().includes("paris"), "paris");
  assert(agg.response_metadata.finish_reason === "tool_calls", "finish");
  const m2 = await b.invoke([new HumanMessage(PW), agg, new ToolMessage({ content: TOOL_RESULT, tool_call_id: agg.tool_calls[0].id })]);
  console.log(" turn2 (from streamed chunk):"); show(m2);
}
async function s5(model: string) {
  const m = await llm(model).invoke([new HumanMessage({ content: [
    { type: "text", text: "What color is this image? One word." },
    { type: "image_url", image_url: { url: RED } },
  ] })]);
  show(m);
  assert(/red/i.test(text(m)), "red");
  const m2 = await llm(model).invoke([new HumanMessage({ content: [
    { type: "text", text: "What color is this image? One word." },
    { type: "image", source_type: "base64", data: RED.split(",")[1], mime_type: "image/png" } as any,
  ] })]);
  console.log(" standard image block:"); show(m2);
  assert(/red/i.test(text(m2)), "red (std block)");
}
async function s6(model: string) {
  const prompt = "Estimate: 2 boiled eggs and a slice of toast.";
  let bad = 0;
  for (const method of ["jsonSchema", "functionCalling", "jsonMode"] as const) {
    console.log(` method=${method}`);
    try {
      const p = prompt + (method === "jsonMode" ? " Respond as JSON with keys calories and protein_g (numbers)." : "");
      const r: any = await llm(model).withStructuredOutput(Meal, { method, includeRaw: true, name: "Meal" }).invoke(p);
      console.log("  raw content:", JSON.stringify(r.raw.content).slice(0, 200), "tool_calls:", JSON.stringify(r.raw.tool_calls));
      console.log("  parsed:", JSON.stringify(r.parsed));
      assert(typeof r.parsed?.calories === "number" && typeof r.parsed?.protein_g === "number", "parsed numbers");
      console.log("  OK");
    } catch (e: any) { bad++; console.log("  FAIL", e?.name, String(e?.message).slice(0, 600)); }
  }
  assert(!bad, `${bad} method(s) failed`);
}
async function s7() {
  // LangChain has no model-list API (n.a.); use the openai SDK that @langchain/openai wraps, same baseURL/key
  const { default: OpenAI } = await import("openai");
  const c = new OpenAI({ apiKey: KEY, baseURL: BASE });
  const ids: string[] = [];
  for await (const m of await c.models.list()) ids.push(m.id);
  console.log("  count:", ids.length, "dups:", ids.length - new Set(ids).size);
  assert(ids.includes(FAST) && ids.includes(CLAUDE) && ids.includes(GPT), "ids");
}
async function err() {
  for (const [label, m, key] of [["bad key", FAST, "bad"], ["bad model", "nope", KEY]] as const) {
    try { await new ChatOpenAI({ model: m, apiKey: key, configuration: { baseURL: BASE }, useResponsesApi: false, maxRetries: 0 }).invoke("hi"); }
    catch (e: any) { console.log(" ", label + ":", e?.name, e?.status, String(e?.message).slice(0, 300)); }
  }
}

const RUNS: Record<string, [string, (m: string) => Promise<void>, string][]> = {
  S1: [["S1", s1, FAST]],
  S1x: [["S1", s1, CLAUDE], ["S1", s1, GPT]],
  S2: [["S2", s2, FAST], ["S2", s2, CLAUDE], ["S2", s2, GPT]],
  S3: [["S3", s3, FAST]],
  S4: [["S4", s4, FAST]],
  S5: [["S5", s5, FAST], ["S5", s5, CLAUDE], ["S5", s5, GPT]],
  S6: [["S6", s6, FAST], ["S6", s6, CLAUDE], ["S6", s6, GPT]],
  GPTALT: [["S1", s1, GPT_ALT], ["S2", s2, GPT_ALT], ["S5", s5, GPT_ALT], ["S6", s6, GPT_ALT]],
  S7: [["S7", () => s7(), "-"]],
  ERR: [["ERR", () => err(), "-"]],
};
for (const k of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RUNS)) {
  for (const [name, fn, model] of RUNS[k] ?? []) {
    console.log(`== ${name} model=${model}`);
    try { await fn(model); console.log("  -> PASS"); } catch (e: any) { console.log("  -> FAIL", e?.stack?.split("\n").slice(0, 3).join(" | ")); }
  }
}
