# LangChain JS

`ChatOpenAI` and `ChatOpenAICompletions` from `@langchain/openai`. For Claude through the Messages API use [LangChain JS (ChatAnthropic)](langchain-anthropic-js.md).

## Connect

Pass `configuration: { baseURL: "http://127.0.0.1:4010/v1" }` and your plugboard key as `apiKey`. The snippets take `client` (`{ baseURL, apiKey }`) and `model`, an alias such as `"fast"` or any allowed `provider/model[#variant]`.

## Chat

<<< @/../examples/langchain-js/chat.ts#snippet

## Tool calls

<<< @/../examples/langchain-js/tools.ts#snippet

## Structured output

<<< @/../examples/langchain-js/structured.ts#snippet

`withStructuredOutput(Meal, { method: "jsonSchema" })` and `method: "functionCalling"` both work. Avoid `jsonMode`: it sends no schema, so the model can return `{}`.

## Limits

- `ChatOpenAI` always uses the Responses API for ids containing `gpt-5.6`, `codex` or a `-pro` model, and `useResponsesApi: false` does not change that. On that route LangChain exposes no `finish_reason`; read `response_metadata.status`. To keep such a model on Chat Completions, use `new ChatOpenAICompletions({ model, apiKey, configuration: { baseURL } })`.
- There is no model-list call. Use the `openai` SDK.
