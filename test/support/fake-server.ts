#!/usr/bin/env bun
/**
 * A standalone plugboard for the Python client harnesses (`compat/py/clients/`): the real OpenAI
 * route (`startRoute`) on a free loopback port, with a scripted fake model. Run it with
 * `bun test/support/fake-server.ts`. It prints two lines, `PLUGBOARD_URL=http://127.0.0.1:<port>`
 * and `PLUGBOARD_KEY=<key>`, and stays up until SIGTERM, SIGINT or the end of its stdin.
 *
 * Unlike the matrix's fake (`test/compat/scenarios.ts`), the model here does not read `[scenario:...]`
 * tags, because the Python clients send their own prompts. It answers from the request alone:
 * a forced or required tool is called with arguments built from its JSON Schema; a prompt that
 * mentions "weather" calls the first tool once; after a tool result it answers in text; a DSPy
 * `[[ ## field ## ]]` prompt gets those fields back; everything else answers `pong`.
 */
import type { CallContext, ModelCaller, PlugEvent, PlugRequest, PlugTool } from "../../src/contract.js"
import { ev } from "./fixtures.js"
import { startRoute } from "./loopback.js"

/** The app key when `FAKE_KEY` is not set. The server prints the key it uses, so harnesses never need this constant. */
export const FAKE_KEY = "sk-plug-fake-python-harness"
export const FAKE_APP = "python"

type Schema = Record<string, any>

/** A value that satisfies a JSON Schema: "Paris" for a `city`, "pong" for other strings, the first enum value, 1 for numbers. */
export function sample(schema: Schema, root: Schema, name = ""): unknown {
  if (typeof schema !== "object" || schema === null) return "pong"
  if (typeof schema.$ref === "string") {
    const target = schema.$ref.replace(/^#\//, "").split("/").reduce<any>((node, key) => node?.[key], root)
    return sample(target ?? {}, root, name)
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if (schema.const !== undefined) return schema.const
  const variants: Schema[] | undefined = schema.anyOf ?? schema.oneOf
  if (variants) return sample(variants.find((v) => v.type !== "null") ?? variants[0]!, root, name)
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type
  if (type === "object" || schema.properties) {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries<Schema>(schema.properties ?? {})) out[key] = sample(value, root, key)
    return out
  }
  if (type === "array") return schema.items ? [sample(schema.items, root, name)] : []
  if (type === "integer" || type === "number") return 1
  if (type === "boolean") return true
  if (type === "null") return null
  return name === "city" ? "Paris" : "pong"
}

const userText = (request: PlugRequest): string =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")

/** The DSPy ChatAdapter answers with one `[[ ## field ## ]]` block per output field, then `completed`. */
function dspyAnswer(request: PlugRequest): string | undefined {
  const text = [...request.system, ...request.messages.flatMap((m) => m.content.map((p) => (p.type === "text" ? p.text : "")))].join("\n")
  if (!text.includes("[[ ##")) return undefined
  const names = [...text.matchAll(/\[\[ ## (\w+) ## \]\]/g)].map((m) => m[1]!).filter((name) => name !== "completed")
  const fields = [...new Set(names.length > 0 ? names : ["answer"])]
  // A typed output carries its JSON schema in the prompt: answer with an object for it, else a string.
  const value = text.includes('"type": "object"') ? '{"answer": "pong"}' : "pong"
  return [...fields.map((name) => `[[ ## ${name} ## ]]\n${value}`), "[[ ## completed ## ]]"].join("\n\n")
}

const finish = (reason: "stop" | "tool-calls") => ev.finish(reason, { inputTokens: 11, outputTokens: 7 })

/** The events of one model call: a tool call or a text answer, as a real model would give. */
export function script(request: PlugRequest): PlugEvent[] {
  const answered = request.messages.some((message) => message.role === "tool")
  const forced = typeof request.toolChoice === "object" ? request.toolChoice.name : undefined
  const tool: PlugTool | undefined = forced ? request.tools.find((t) => t.name === forced) : request.toolChoice === "required" ? request.tools[0] : undefined
  if (tool) return [ev.call("call_fake_1", tool.name, sample(tool.parameters, tool.parameters)), finish("tool-calls")]
  if (answered) return text("It is 18 C and cloudy in Paris.")
  const first = request.tools[0]
  if (first && request.toolChoice !== "none" && /weather/i.test(userText(request))) return [ev.call("call_fake_1", first.name, sample(first.parameters, first.parameters)), finish("tool-calls")]
  return text(dspyAnswer(request) ?? "pong")
}

/** Text as two deltas, so a streaming client has to accumulate. */
function text(answer: string): PlugEvent[] {
  const half = Math.ceil(answer.length / 2)
  const parts = answer.length > 1 ? [answer.slice(0, half), answer.slice(half)] : [answer]
  return [...parts.map((part) => ev.text(part)), finish("stop")]
}

export const fakeModel: ModelCaller = {
  async *stream(request: PlugRequest, _context: CallContext): AsyncIterable<PlugEvent> {
    for (const event of script(request)) yield event
  },
}

if (import.meta.main) {
  const key = process.env.FAKE_KEY ?? FAKE_KEY
  const route = await startRoute({
    caller: fakeModel,
    options: { keys: { [FAKE_APP]: key }, models: ["test/*"], aliases: { fast: "test/echo" } },
  })
  console.log(`PLUGBOARD_URL=${route.url}`)
  console.log(`PLUGBOARD_KEY=${key}`)
  const stop = () => void route.close().then(() => process.exit(0))
  process.on("SIGTERM", stop)
  process.on("SIGINT", stop)
  process.stdin.on("end", stop)
  process.stdin.resume()
}
