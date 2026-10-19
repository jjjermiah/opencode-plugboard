// S2, tool call and tool-result turn. The model asks for get_weather, the app answers, the model finishes.
import OpenAI from "openai"
import { responsesFinishReason } from "./chat.ts"

const PROMPT = "What is the weather in Paris? Use the tool."

export async function run(client: OpenAI, model: string) {
  // #region snippet
  const tool: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
      name: "get_weather",
      description: "Current weather for a city",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    },
  }
  const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "user", content: "What is the weather in Paris? Use the tool." }]
  const first = await client.chat.completions.create({ model, messages, tools: [tool], max_tokens: 1024 })
  const message = first.choices[0]!.message
  const call = message.tool_calls![0]!
  // Send the assistant turn back as the SDK typed it, then the result under the same call id.
  messages.push(message, { role: "tool", tool_call_id: call.id, content: JSON.stringify({ temp_c: 18, sky: "cloudy" }) })
  const second = await client.chat.completions.create({ model, messages, tools: [tool], max_tokens: 1024 })
  // #endregion snippet
  const city = call.type === "function" ? (JSON.parse(call.function.arguments) as { city?: string }).city ?? "" : ""
  return {
    finish_reason: first.choices[0]?.finish_reason ?? null,
    tool_name: call.type === "function" ? call.function.name : null,
    tool_city: city,
    tool_call_id: call.id,
    final_text: second.choices[0]?.message.content ?? "",
    final_finish_reason: second.choices[0]?.finish_reason ?? null,
  }
}

// The Responses API takes the function flat: the name at the top level, not under `function`.
const responsesTool: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: "get_weather",
  description: "Current weather for a city",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  strict: false,
}
const TOOL_RESULT = JSON.stringify({ temp_c: 18, sky: "cloudy" })

function responsesObservations(first: OpenAI.Responses.Response, second: OpenAI.Responses.Response, call: OpenAI.Responses.ResponseFunctionToolCall) {
  return {
    finish_reason: responsesFinishReason(first),
    tool_name: call.name,
    tool_city: (JSON.parse(call.arguments) as { city?: string }).city ?? "",
    tool_call_id: call.call_id,
    final_text: second.output_text,
    final_finish_reason: responsesFinishReason(second),
  }
}

export async function runResponses(client: OpenAI, model: string) {
  // #region snippet-responses
  const first = await client.responses.create({ model, input: PROMPT, tools: [responsesTool], store: false, max_output_tokens: 1024 })
  const call = first.output.find((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call")
  if (!call) throw new Error("no function_call in the answer")
  // Store is off, so the whole conversation goes back in input: the answer's items as the SDK typed them, then the result.
  // The SDK types output items apart from input items; the wire takes the same objects, so they are cast here.
  const input = [
    { role: "user", content: PROMPT },
    ...(first.output as OpenAI.Responses.ResponseInputItem[]),
    { type: "function_call_output", call_id: call.call_id, output: TOOL_RESULT },
  ] satisfies OpenAI.Responses.ResponseInputItem[]
  const second = await client.responses.create({ model, input, tools: [responsesTool], store: false, max_output_tokens: 1024 })
  // #endregion snippet-responses
  return responsesObservations(first, second, call)
}

/** The same round trip with previous_response_id in place of the replayed history. Plugboard keeps the first answer (store is on by default) and continues from it. */
export async function runResponsesPreviousId(client: OpenAI, model: string) {
  const first = await client.responses.create({ model, input: PROMPT, tools: [responsesTool], max_output_tokens: 1024 })
  const call = first.output.find((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call")
  if (!call) throw new Error("no function_call in the answer")
  const second = await client.responses.create({
    model,
    previous_response_id: first.id,
    input: [{ type: "function_call_output", call_id: call.call_id, output: TOOL_RESULT }],
    tools: [responsesTool],
    max_output_tokens: 1024,
  })
  return responsesObservations(first, second, call)
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client, "fast")))
}
