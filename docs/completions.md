# Legacy completions and `n`

`POST /v1/completions` serves older scripts, and `n` above 1 works on Chat Completions and `/v1/completions`. Keys, model ids, aliases and limits are the same as everywhere else; see [configuration](configuration.md).

## `POST /v1/completions`

The legacy text completion API. OpenCode's models are chat models, so a prompt is sent as one user message with no system prompt, and the model answers as it would in chat. Instruction-tuned models usually continue or answer the text sensibly, but this is not a raw completion model: do not expect it to continue mid-sentence the way a base model does.

```ts
import OpenAI from "openai"

const client = new OpenAI({ baseURL: "http://localhost:4010/v1", apiKey: process.env.PLUGBOARD_KEY })
const r = await client.completions.create({ model: "fast", prompt: "Reply with exactly: pong", max_tokens: 20 })
console.log(r.choices[0].text)
```

The same with curl and `jq`. `PLUGBOARD_BASE_URL` is `http://127.0.0.1:4010/v1` and `PLUGBOARD_KEY` is your key:

<<< @/../examples/curl/completions.sh#snippet

<<< @/../examples/curl/completions.sh#snippet-s1

The response is the legacy `text_completion` object: `choices[].text`, `index`, `finish_reason` (`stop`, `length`, `content_filter`), `logprobs: null`, and `usage`. With `stream: true` the chunks are `text_completion` objects with `choices[].text`, then a chunk with empty text and the `finish_reason`, then `data: [DONE]`. `stream_options.include_usage` adds the usual last chunk with `choices: []` and the usage.

| Request field | How it is handled |
| --- | --- |
| `model` | Same as Chat Completions: an alias or `provider/model[#variant]`. |
| `prompt` | A string, or an array of strings. Each string is its own prompt (see below). An array of token ids or of token arrays is a 400. |
| `suffix` | Sent as an instruction in a system prompt: reply with the text that belongs between the prompt and the suffix. A chat model has no insert mode, so this is best effort and varies by model. It is the only case where plugboard adds a system prompt. |
| `max_tokens`, `temperature`, `top_p`, `presence_penalty`, `frequency_penalty`, `seed` | Passed to the model. A model whose protocol sends no seed (Claude, GPT-5 and 6) drops `seed` and lists it in `x-plugboard-dropped-params`. Sampling parameters the model is known to reject are dropped and listed in `x-plugboard-dropped-params`, as in Chat Completions (`dropUnsupportedParams`). Without `max_tokens` the model's own default applies, not the legacy default of 16. |
| `stop` | Matched by plugboard on the answer text, and not sent to the model. The answer ends at the first sequence, which is removed. Reasoning is never matched. |
| `echo` | `true` writes the prompt ahead of the completion text in each choice (in a stream, as the first chunk). |
| `n` | Independent completions per prompt, see below. |
| `stream`, `stream_options` | As above. |
| `reasoning_effort` | Picks the model variant, as in Chat Completions. |
| `response_format` | Same as Chat Completions. `json_schema` forces the `respond` tool and the answer is its arguments as the text; `json_object` asks for a JSON object in a system instruction, and one code fence around it is stripped. `text` changes nothing. See [structured output](#structured-output). |
| `user`, `logit_bias` | Accepted and ignored. |

Refused with a 400 `unsupported_parameter` naming the field: `logprobs` (the host exposes none, a `null` is fine), `best_of` above 1, and token-array prompts.

An array of prompts makes one model call per prompt, and `n` multiplies that. Choice `i` answers prompt `floor(i / n)`, which is the legacy numbering. The total number of calls must not exceed `maxN`.

### Structured output

With `stream: true`, `json_schema` and `json_object` are both written as one chunk when the model finishes, because the schema check and the fence strip need the whole answer. They do not stream token by token as Chat Completions does.

A structured answer with no respond call is taken from the final text when it is the JSON the schema asks for (the same small check as chat). Otherwise it is a 502 `structured_output_missing`.

## `n` above 1

`n` asks for several independent answers. Plugboard runs one model call per choice, all at once, each in its own session, and merges them into one response:

- Non-stream: `choices[i]` with the `index` and the `finish_reason` of call `i`. `usage` is the sum of all calls.
- Stream: every chunk carries the `index` of its choice and one choice only. Chunks of different choices interleave as they arrive. All chunks share one `id`. There is one `data: [DONE]` at the end. With `include_usage`, the last chunk before it carries the summed usage.
- Tools, `tool_choice` and `response_format` work with `n`: each choice is independent, so each may call tools or answer in the structured format on its own.

**Cost.** Each choice is a full model call and a kept history session. `n: 4` costs four calls in tokens, in provider rate limits and in history. That is why the `maxN` option caps it, and why the default is `1`: a request above the cap gets a 400 `too_many_choices` before any model call runs. Raise `maxN` when you trust your callers with the spend. Each choice also takes its own slot under [`limits`](configuration.md#concurrency-and-rate-limits): with `maxConcurrent: 2`, an `n: 4` request has its choices over the cap refused with 429, and the whole request fails as described under Failure.

**Failure.** If any choice fails, the whole request fails and the other choices are cancelled (their sessions are interrupted). A partial set of answers looks like a complete one, and callers that sample `n` times to compare or average would be misled. The first failure decides the error. In a non-stream request and in a stream that has not sent anything yet, that is an ordinary HTTP error. In a stream that has already started, it is an `error` frame followed by `[DONE]`, as for a single stream. A client that disconnects or a request that times out cancels every choice.

**History.** Each choice leaves its own session. The `x-plugboard-session` header lists the record ids, comma separated in choice order. In a stream it lists the ones reported before the first chunk went out.
