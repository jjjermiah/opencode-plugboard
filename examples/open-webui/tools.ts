// #region snippet
import { at, call, type Owui } from "./owui.ts"

const PROMPT = "What is the weather in Paris? Use the tool."

/**
 * The Weather tool the scenarios use. Open WebUI runs Python tools itself, so the tool lives in its database; the
 * runner creates it once before the scenarios (the API is admin-only, and the runner is the admin).
 */
export const WEATHER_TOOL = `"""
title: Weather
description: examples test tool
"""
class Tools:
    def get_weather(self, city: str) -> str:
        """Get the current weather for a city.
        :param city: City name, e.g. Paris
        """
        return '{"temp_c":18,"sky":"cloudy"}'
`

/** Creates the Weather tool (id `weather`). */
export async function createWeatherTool(owui: Owui): Promise<void> {
  const { status } = await call(owui, "POST", "/api/v1/tools/create", {
    id: "weather",
    name: "Weather",
    content: WEATHER_TOOL,
    meta: { description: "examples test tool", manifest: {} },
    access_grants: [],
  })
  if (status !== 200) throw new Error(`creating the weather tool failed: HTTP ${status}`)
}

/**
 * One chat turn with the Weather tool, as the frontend sends it: a chat record first, then the completion with its
 * chat_id. Open WebUI runs the tool and sends the result back to the model itself, so the tool call is read from the
 * stored chat record. background_tasks is empty, so no title or tag calls happen.
 */
export async function toolTurn(owui: Owui, model: string, stream: boolean) {
  const now = Math.floor(Date.now() / 1000)
  const userId = crypto.randomUUID()
  const assistantId = crypto.randomUUID()
  const user = { id: userId, parentId: null, childrenIds: [assistantId], role: "user", content: PROMPT, timestamp: now, models: [model] }
  const assistant = { id: assistantId, parentId: userId, childrenIds: [], role: "assistant", content: "", model, modelName: model, timestamp: now }
  const created = await call(owui, "POST", "/api/v1/chats/new", {
    chat: {
      title: "New Chat",
      models: [model],
      history: { messages: { [userId]: user, [assistantId]: assistant }, currentId: assistantId },
      messages: [user, assistant],
      params: {},
      timestamp: now * 1000,
    },
  })
  const chatId = at(created.json, "id") as string
  await call(owui, "POST", "/api/chat/completions", {
    stream,
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: PROMPT }],
    params: {},
    features: {},
    variables: {},
    session_id: `examples-${userId.slice(0, 8)}`,
    chat_id: chatId,
    id: assistantId,
    parent_id: userId,
    parent_message: user,
    tool_ids: ["weather"],
    background_tasks: {},
  })
  // The completion POST returns before Open WebUI has run the turn, so wait for the stored message to be done.
  const deadline = Date.now() + 240_000
  let record = await call(owui, "GET", `/api/v1/chats/${chatId}`)
  while (at(record.json, "chat", "history", "messages", assistantId, "done") !== true && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    record = await call(owui, "GET", `/api/v1/chats/${chatId}`)
  }
  const message = at(record.json, "chat", "history", "messages", assistantId) as Record<string, unknown> | undefined
  return { message, record: record.json }
}

/** The observations for a stored turn: the tool call Open WebUI made, and the answer it stored. */
export function observe(message: Record<string, unknown> | undefined) {
  const output = (message?.output as Array<Record<string, unknown>> | undefined) ?? []
  const call = output.find((item) => item.type === "function_call")
  const content = typeof message?.content === "string" ? message.content : null
  return {
    finish_reason: call ? "tool_calls" : null,
    tool_name: call?.name ?? null,
    tool_city: call ? (JSON.parse(String(call.arguments)) as { city?: unknown }).city ?? null : null,
    tool_call_id: call?.call_id ?? null,
    final_text: content,
    final_finish_reason: content ? "stop" : null,
  }
}

/**
 * S2: a tool call, then the tool result turn. Open WebUI runs that loop only on the streamed path, the one its UI sends:
 * a non-stream request stops after the first tool call.
 */
export async function run(owui: Owui, model: string) {
  const { message } = await toolTurn(owui, model, true)
  return observe(message)
}
// #endregion snippet

if (import.meta.main) {
  const owui: Owui = { base: process.env.OWUI_BASE!, token: process.env.OWUI_TOKEN!, upstream: process.env.OWUI_UPSTREAM ?? "" }
  console.log(JSON.stringify(await run(owui, process.env.MODEL ?? "fast")))
}
