# OpenAI JS SDK

Tested: `openai` 7.32.0 with `zod` 4.6.6, 2026-10-11, at an earlier commit. Scenarios S1 to S7 and the error paths passed.

```ts
import OpenAI from "openai"

const client = new OpenAI({ baseURL: "http://localhost:4010/v1", apiKey: process.env.PLUGBOARD_KEY })
```

`fast` below is an alias from the plugboard `aliases` option. Use any allowed `provider/model[#variant]` instead.

## Chat

```ts
const r = await client.chat.completions.create({
  model: "fast",
  messages: [{ role: "user", content: "Reply with exactly: pong" }],
})
console.log(r.choices[0]?.message.content)
```

## Tool call

Plugboard returns the call. Your code runs it and sends the result back.

```ts
const tools = [{ type: "function" as const, function: {
  name: "get_weather", description: "Current weather for a city",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }]
const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "user", content: "What is the weather in Paris? Use the tool." }]

const first = await client.chat.completions.create({ model: "fast", messages, tools })
const msg = first.choices[0]!.message             // finish_reason === "tool_calls"
const call = msg.tool_calls![0]!
messages.push(msg, { role: "tool", tool_call_id: call.id, content: '{"temp_c":18,"sky":"cloudy"}' })
const second = await client.chat.completions.create({ model: "fast", messages, tools })
console.log(second.choices[0]?.message.content)
```

`client.chat.completions.runTools` also works. It runs your function in the client.

## Structured output

`zodResponseFormat(Meal, "meal")` with `.parse()` or `.stream()` works on every model tested and fills `message.parsed`. Plugboard instructs the model to answer through a `respond` tool. The provider does not enforce the schema.

## Gotchas

- Streaming usage needs `stream_options: { include_usage: true }`. The `.stream()` helper assembles the single-delta tool call correctly.
- `models.list()` and `client.models.retrieve(id)` (`GET /v1/models/{id}`) are both served. `retrieve` was added after the 2026-10-11 run; it passes live with this SDK (S7 in `examples/openai-js/runs/live/`).
- A wrong key throws `AuthenticationError` (401). An unknown model throws `NotFoundError` (404), also with `stream: true`.
