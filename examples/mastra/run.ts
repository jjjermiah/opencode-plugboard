// Runner for the Mastra example. Started by examples/_harness/run.ts, which captures the traffic and writes the run.
// This file writes nothing: it prints one JSON line per scenario and model.
//
//   bun run.ts          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
//
// The scenarios are the ones in agent.ts: S1 text, S2 tool round trip, S3 stream, S4 streamed tool call.
// S5 to S7 and E1/E2 are not in this runner yet.
import { readFileSync } from "node:fs"
import { Agent } from "@mastra/core/agent"
import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { emitClient, runAll } from "../_harness/ts/harness.ts"

const BASE_URL = process.env.PLUGBOARD_BASE_URL ?? "http://127.0.0.1:4010/v1"
const KEY = process.env.PLUGBOARD_KEY ?? ""
const PROMPT = "Reply with exactly: pong"
const TOOL_PROMPT = "What is the weather in Paris? Use the tool."
const TOOL_RESULT = readFileSync(new URL("../_shared/get_weather.result.json", import.meta.url), "utf8").trim()

const version = JSON.parse(readFileSync(new URL("./node_modules/@mastra/core/package.json", import.meta.url), "utf8")).version as string
emitClient("@mastra/core", version)

// Mastra routes a model through its provider prefix, so each id is `plugboard/<model>`.
function agentFor(model: string, withTool: boolean): Agent {
  const weather = createTool({
    id: "get_weather",
    description: "Current weather for a city.",
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.object({ temp_c: z.number(), sky: z.string() }),
    execute: async () => JSON.parse(TOOL_RESULT),
  })
  return new Agent({
    id: "plugboard-agent",
    name: "Plugboard",
    instructions: "Be concise.",
    model: { id: `plugboard/${model}`, url: BASE_URL, apiKey: KEY },
    tools: withTool ? { get_weather: weather } : {},
  })
}

// Mastra names a tool-call step with the AI SDK's `tool-calls`; the wire carries OpenAI's `tool_calls`. Map the name
// so the observation matches the scenario's check. The harness still reads the wire itself.
const openaiReason = (reason: string | undefined) => (reason === "tool-calls" ? "tool_calls" : reason)

const s1 = async (model: string) => {
  const res = await agentFor(model, false).generate(PROMPT)
  return { text: res.text, finish_reason: res.finishReason, usage: res.usage ?? null }
}

const s2 = async (model: string) => {
  const res = await agentFor(model, true).generate(TOOL_PROMPT)
  const first = res.steps[0]
  const call = first?.toolCalls[0]?.payload
  return {
    finish_reason: openaiReason(first?.finishReason),
    tool_name: call?.toolName ?? "",
    tool_city: (call?.args as { city?: string } | undefined)?.city ?? "",
    tool_call_id: call?.toolCallId ?? null,
    final_text: res.text,
    final_finish_reason: res.finishReason,
  }
}

const s3 = async (model: string) => {
  const stream = await agentFor(model, false).stream(PROMPT)
  let text = ""
  for await (const chunk of stream.textStream) text += chunk
  return { text, finish_reason: await stream.finishReason, usage: (await stream.usage) ?? null, done: true }
}

const s4 = async (model: string) => {
  const stream = await agentFor(model, true).stream(TOOL_PROMPT)
  for await (const _ of stream.textStream) {
    // Drain the stream so the tool loop completes before the calls are read.
  }
  const first = (await stream.steps)[0]
  const call = first?.toolCalls[0]?.payload
  return {
    finish_reason: openaiReason(first?.finishReason),
    tool_name: call?.toolName ?? "",
    tool_city: (call?.args as { city?: string } | undefined)?.city ?? "",
    tool_call_id: call?.toolCallId ?? null,
  }
}

await runAll({ S1: s1, S2: s2, S3: s3, S4: s4 })
