// S1 smoke: plain chat against `fast` through the OpenAI JS SDK. Run: cd compat/js && bun smoke.ts
import OpenAI from "openai"
import { homedir } from "node:os"
import { readFileSync } from "node:fs"

const baseURL = process.env.PLUGBOARD_BASE_URL ?? "http://127.0.0.1:4010/v1"
const apiKey = process.env.PLUGBOARD_KEY ?? readFileSync(`${homedir()}/.cache/opencode-adapter-dev/.compat-key`, "utf8").trim()

const client = new OpenAI({ baseURL, apiKey })
const r = await client.chat.completions.create({ model: "fast", messages: [{ role: "user", content: "Reply with exactly: pong" }] })
console.log("model:", r.model, "| finish:", r.choices[0]?.finish_reason)
console.log("content:", JSON.stringify(r.choices[0]?.message.content), "| usage:", JSON.stringify(r.usage))
if (!r.choices[0]?.message.content || r.choices[0].finish_reason !== "stop") throw new Error("S1 failed")
console.log("S1 OK")
