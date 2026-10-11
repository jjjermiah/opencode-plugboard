// S1 smoke: plain chat against `fast` through the OpenAI JS SDK.
// Run: cd compat/js && PLUGBOARD_KEY=... bun smoke.ts
// Env: PLUGBOARD_BASE_URL (default http://127.0.0.1:4010/v1), PLUGBOARD_KEY (required).
import OpenAI from "openai"

const baseURL = process.env.PLUGBOARD_BASE_URL ?? "http://127.0.0.1:4010/v1"
const apiKey = process.env.PLUGBOARD_KEY
if (!apiKey) throw new Error("set PLUGBOARD_KEY")

const client = new OpenAI({ baseURL, apiKey })
const r = await client.chat.completions.create({ model: "fast", messages: [{ role: "user", content: "Reply with exactly: pong" }] })
const content = r.choices[0]?.message.content ?? ""
console.log("model:", r.model, "| finish:", r.choices[0]?.finish_reason)
console.log("content:", JSON.stringify(content), "| usage:", JSON.stringify(r.usage))
if (!content.toLowerCase().includes("pong")) throw new Error(`S1 failed: expected pong, got ${JSON.stringify(content)}`)
if (r.choices[0]?.finish_reason !== "stop") throw new Error(`S1 failed: finish_reason ${r.choices[0]?.finish_reason}`)
console.log("S1 OK")
