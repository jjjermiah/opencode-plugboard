// A stdio MCP server with one tool, get_weather. Codex has no way to add a custom function tool to a headless run, but it
// loads MCP servers from config.toml, so this is the tool the S2 and S4 scenarios call. Newline-delimited JSON-RPC on
// stdin and stdout, no SDK: initialize, tools/list and tools/call are all Codex needs.
import { createInterface } from "node:readline"

const TOOL = {
  name: "get_weather",
  description: "Current weather for a city.",
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
}

const reply = (id: unknown, result: unknown) => console.log(JSON.stringify({ jsonrpc: "2.0", id, result }))

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === "") continue
  const message = JSON.parse(line) as { id?: unknown; method: string; params?: { protocolVersion?: string; arguments?: { city?: string } } }
  if (message.id === undefined) continue // a notification (notifications/initialized): no answer
  if (message.method === "initialize") {
    reply(message.id, { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "weather", version: "1.0.0" } })
  } else if (message.method === "tools/list") {
    reply(message.id, { tools: [TOOL] })
  } else if (message.method === "tools/call") {
    const city = message.params?.arguments?.city ?? "unknown"
    reply(message.id, { content: [{ type: "text", text: JSON.stringify({ temp_c: 18, sky: "cloudy", city }) }] })
  } else {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `no such method: ${message.method}` } }))
  }
}
