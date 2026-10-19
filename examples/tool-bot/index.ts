// A tool-call round trip against plugboard. Plugboard returns tool_calls and never runs them:
// this script runs the tool, sends the result back as a `tool` message, and repeats until the
// model answers in text.
//
//   PLUGBOARD_KEY=<key> bun index.ts "What is the weather in Paris?"
import OpenAI from "openai"

const apiKey = process.env.PLUGBOARD_KEY
if (!apiKey) throw new Error("set PLUGBOARD_KEY to a plugboard key")
const client = new OpenAI({
  baseURL: process.env.PLUGBOARD_URL ?? "http://127.0.0.1:4010/v1",
  apiKey,
})
const model = process.env.PLUGBOARD_MODEL ?? "fast"

// #region snippet-tool
const tools: OpenAI.ChatCompletionTool[] = [{
  type: "function",
  function: {
    name: "get_weather",
    description: "Current weather for a city",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
}]

// The bot's own tools. This one is a stub; a real bot would call a weather API.
const runTool: Record<string, (args: { city: string }) => unknown> = {
  get_weather: ({ city }) => ({ city, temp_c: 18, sky: "cloudy" }),
}
// #endregion snippet-tool

const messages: OpenAI.ChatCompletionMessageParam[] = [
  { role: "user", content: process.argv[2] ?? "What is the weather in Paris? Use the tool." },
]

// #region snippet
for (let turn = 1; turn <= 5; turn++) {
  const res = await client.chat.completions.create({ model, messages, tools })
  const msg = res.choices[0]!.message
  messages.push(msg)
  if (!msg.tool_calls?.length) {
    console.log(msg.content)
    process.exit(0)
  }
  for (const call of msg.tool_calls) {
    let result: unknown = { error: "unsupported tool call type" }
    if (call.type === "function") {
      const run = runTool[call.function.name]
      result = run ? run(JSON.parse(call.function.arguments)) : { error: `unknown tool ${call.function.name}` }
    }
    // Every tool_call id needs a matching tool message, or the next request is rejected.
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) })
  }
}
// #endregion snippet
throw new Error("no text answer after 5 turns")
