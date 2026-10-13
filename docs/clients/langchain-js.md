# LangChain JS

<ExampleResult example="langchain-js" />

Tested: `@langchain/openai` 1.6.2, `@langchain/core` 1.2.17. Live run [`2026-10-13-c97ac66-2`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langchain-js/runs/live/2026-10-13-c97ac66-2) at plugboard 0.26.0 (`c97ac66`): partial. Every scenario passed on `fast` and `anthropic/claude-haiku-4-5`. On `openai/gpt-5.6-luna#low`, S1 and S2 pass through `ChatOpenAICompletions` but not through `ChatOpenAI` (the Responses route, below). `jsonMode` on `fast` returned a correct object in this run; the 2026-10-11 run returned `{}`. The code below is the example's snippet, and the run's report and transcripts are in the example directory.

The snippets take `client` (`{ baseURL, apiKey }`), `model` (`"fast"`) and `variant`: `"auto"` (the default, `ChatOpenAI`) or `"chat"` (`ChatOpenAICompletions`). The code below is the `auto` path. `fast` is an alias from the plugboard `aliases` option. See the gotcha before you use a `gpt-5.6` id.

## Chat

<<< @/../examples/langchain-js/chat.ts#snippet

## Tool call

<<< @/../examples/langchain-js/tools.ts#snippet

## Structured output

The snippet uses `client` and `model`, and defines `Meal` (a zod object) and `PROMPT` itself.

<<< @/../examples/langchain-js/structured.ts#snippet

`withStructuredOutput(Meal, { method: "jsonSchema" })` and `method: "functionCalling"` work. `jsonMode` sends `json_object` with no schema, and a weak model can return `{}`.

## Gotchas

- Model ids containing `gpt-5.6` (also `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro`, `codex`) force the Responses API when you use `ChatOpenAI`, and `useResponsesApi: false` does not override it. Plugboard serves that API (see [Responses API](../responses.md)). On 2026-10-13, `openai/gpt-5.6-luna#low` passed image input and `withStructuredOutput` (`jsonSchema`, `functionCalling`) through `ChatOpenAI`; streaming was run on `fast` only. For `invoke` and a tool round trip, `finish_reason` is missing on that route: plugboard returns `status: "completed"`, and LangChain does not expose a `finish_reason` for it. Check `response_metadata.status` there instead. To keep the same id on Chat Completions, use `ChatOpenAICompletions`: `new ChatOpenAICompletions({ model: "openai/gpt-5.6-luna#low", apiKey, configuration: { baseURL } })`.
- There is no list-models call. Use the `openai` SDK directly.
