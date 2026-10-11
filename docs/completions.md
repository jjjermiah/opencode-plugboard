# Legacy completions and `n`

Two additions to the OpenAI endpoints, both opt-in by what the client sends: `POST /v1/completions` for older scripts, and `n` above 1 on Chat Completions and `/v1/completions`. Keys, model ids, aliases and limits are the same as everywhere else; see [configuration](configuration.md).

## `POST /v1/completions`

The legacy text completion API. OpenCode's models are chat models, so a prompt is sent as one user message with no system prompt, and the model answers as it would in chat. Instruction-tuned models usually continue or answer the text sensibly, but this is not a raw completion model: do not expect it to continue mid-sentence the way a base model does.

```ts
import OpenAI from "openai"

const client = new OpenAI({ baseURL: "http://localhost:4010/v1", apiKey: process.env.PLUGBOARD_KEY })
const r = await client.completions.create({ model: "fast", prompt: "Reply with exactly: pong", max_tokens: 20 })
console.log(r.choices[0].text)
```

The response is the legacy `text_completion` object: `choices[].text`, `index`, `finish_reason` (`stop`, `length`, `content_filter`), `logprobs: null`, and `usage`. With `stream: true` the chunks are `text_completion` objects with `choices[].text`, then a chunk with empty text and the `finish_reason`, then `data: [DONE]`. `stream_options.include_usage` adds the usual last chunk with `choices: []` and the usage.

| Request field | How it is handled |
| --- | --- |
| `model` | Same as Chat Completions: an alias or `provider/model[#variant]`. |
| `prompt` | A string, or an array of strings. Each string is its own prompt (see below). An array of token ids or of token arrays is a 400. |
| `suffix` | Sent as an instruction in a system prompt: reply with the text that belongs between the prompt and the suffix. A chat model has no insert mode, so this is best effort and varies by model. It is the only case where plugboard adds a system prompt. |
| `max_tokens`, `temperature`, `top_p`, `stop`, `presence_penalty`, `frequency_penalty` | Passed to the model. Sampling parameters the model is known to reject are dropped and listed in `x-plugboard-dropped-params`, as in Chat Completions (`dropUnsupportedParams`). Without `max_tokens` the model's own default applies, not the legacy default of 16. |
| `echo` | `true` writes the prompt ahead of the completion text in each choice (in a stream, as the first chunk). |
| `n` | Independent completions per prompt, see below. |
| `stream`, `stream_options` | As above. |
| `reasoning_effort` | Picks the model variant, as in Chat Completions. |
| `user`, `seed`, `logit_bias` | Accepted and ignored. |

Rejected with a 400 `unsupported_parameter` naming the field: `logprobs` (the host exposes none, a `null` is fine), `best_of` above 1, and token-array prompts.

An array of prompts makes one model call per prompt, and `n` multiplies that. Choice `i` answers prompt `floor(i / n)`, which is the legacy numbering. The total number of calls must not exceed `maxN`.

## `n` above 1

`n` asks for several independent answers. Plugboard runs one model call per choice, all at once, each in its own session, and merges them into one response:

- Non-stream: `choices[i]` with the `index` and the `finish_reason` of call `i`. `usage` is the sum of all calls.
- Stream: every chunk carries the `index` of its choice and one choice only. Chunks of different choices interleave as they arrive. All chunks share one `id`. There is one `data: [DONE]` at the end. With `include_usage`, the last chunk before it carries the summed usage.
- Tools, `tool_choice` and `response_format` work with `n`: each choice is independent, so each may call tools or answer in the structured format on its own.

**Cost.** Each choice is a full model call and a kept history session. `n: 4` costs four calls in tokens, in provider rate limits and in history. That is why the `maxN` option caps it, and why the default is `1`: a request above the cap gets a 400 `too_many_choices` before any model call runs. Raise `maxN` when you trust your callers with the spend. There is still no per-app concurrency limit ([#54](https://github.com/jjjermiah/opencode-plugboard/issues/54)).

**Failure.** If any choice fails, the whole request fails and the other choices are cancelled (their sessions are interrupted). A partial set of answers looks like a complete one, and callers that sample `n` times to compare or average would be misled. The first failure decides the error. In a non-stream request and in a stream that has not sent anything yet, that is an ordinary HTTP error. In a stream that has already started, it is an `error` frame followed by `[DONE]`, as for a single stream. A client that disconnects or a request that times out cancels every choice.

**History.** Each choice leaves its own session. The `x-plugboard-session` header lists the record ids, comma separated in choice order. In a stream it lists the ones reported before the first chunk went out.

Tested with the `openai` JS SDK 7.32 against a fake model backend: `completions.create` (plain, streamed, array prompt with `n`), `chat.completions.create({ n: 3 })` plain and streamed, and the SDK's `chat.completions.stream` helper. Not run against a live OpenCode server or a real provider.
