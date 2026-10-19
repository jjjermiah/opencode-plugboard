# Anthropic Messages API

`POST /v1/messages` is served next to Chat Completions and Responses, with the same keys, model ids, aliases and limits. Use it when a client only speaks the Anthropic Messages API: the Anthropic SDKs, Claude Code, and agent tools built on them. They can then use any OpenCode provider through plugboard, including ChatGPT, Copilot and Go models.

Plugboard is stateless here: every request carries the whole conversation in `messages`. Setup guides for the SDKs, LangChain, pydantic-ai, the Vercel AI SDK and Claude Code are in [clients](clients/index.md).

```ts
import Anthropic from "@anthropic-ai/sdk"

// baseURL has no /v1: the SDK adds /v1/messages itself.
const client = new Anthropic({ baseURL: "http://localhost:4010", apiKey: process.env.PLUGBOARD_KEY })
const m = await client.messages.create({ model: "fast", max_tokens: 256, messages: [{ role: "user", content: "Reply with exactly: pong" }] })
```

## Auth

Send the plugboard key as `x-api-key` (what the Anthropic SDKs do) or as `Authorization: Bearer` (what Claude Code does with `ANTHROPIC_AUTH_TOKEN`). Both check the same key store. If both headers are present and the bearer token is not a key, `x-api-key` is tried next. Without `keys` on a loopback listener no header is needed. `anthropic-version` and `anthropic-beta` are accepted and ignored.

## Model list

`GET /v1/models` answers Anthropic's list shape when the request carries `anthropic-version` (the SDKs send it). It pages like Anthropic: `limit` (default 20, from 1 to 1000), `after_id` and `before_id`, using the ids in `first_id` and `last_id`. `has_more` says whether the page's direction has models left. An unknown cursor, both cursors, or a limit outside 1 to 1000 is a 400. Without `anthropic-version` the list is OpenAI's, unpaged.

## Claude Code

```sh
export ANTHROPIC_BASE_URL=http://localhost:4010
export ANTHROPIC_AUTH_TOKEN="$PLUGBOARD_KEY"   # any non-empty value on a keyless loopback listener
export ANTHROPIC_MODEL=claude-sonnet           # a plugboard alias or provider/model[#variant]
export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku
claude
```

Define the aliases in the plugboard `aliases` option (for example `"claude-sonnet": "anthropic/claude-sonnet-4-6"`), or pass full ids such as `anthropic/claude-sonnet-4-6`. Claude Code also sends background requests (titles, summaries) to its small model, so set `ANTHROPIC_DEFAULT_HAIKU_MODEL` (and `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` if you switch with `/model`) to ids or aliases plugboard serves. Otherwise those calls fail with 404 `not_found_error`.

## What is supported

| Request field | How it is handled |
| --- | --- |
| `model` | Same as Chat Completions: an alias or `provider/model[#variant]`. The response echoes the string you sent. |
| `max_tokens` | Required, a positive integer, passed to the model. |
| `system` | A string, or text blocks. `cache_control` on a system block is accepted and ignored: the app's policy and OpenCode's own placement decide the system cache. The one exception is a caller's `ttl: "1h"` block later in `messages`, which can set the 1-hour TTL on the system's first and last part (see [Prompt caching](#prompt-caching)). |
| `messages` | `user` and `assistant` turns with a string or content blocks: `text`, `image` (`base64`, `url` or `file` source), `document` (`base64`, `url`, `text` or `file` source: a file id from the [Files API](files.md)), `tool_use` (assistant), `tool_result` (user). `thinking` and `redacted_thinking` blocks: see [Thinking blocks](#thinking-blocks). `cache_control` (`ephemeral`) on a `text`, `image`, `document` or `tool_result` block is a cache breakpoint the caller chose: see [Prompt caching](#prompt-caching). |
| `tool_result` | `content` as a string or text and image blocks, `is_error` passed on. Each result must answer a `tool_use` block from an earlier assistant turn. Images inside a result are passed as user media after the results. |
| `tools` | Custom tools with `name`, `description` and `input_schema`. `cache_control` on `tools` is ignored. |
| `tool_choice` | `auto`, `any`, `none`, `{"type":"tool","name":"..."}`. `disable_parallel_tool_use: true` keeps only the first tool call of the answer, as `parallel_tool_calls: false` does on Chat Completions; the response carries `x-plugboard-parallel-tools: limited`. |
| `temperature`, `top_p` | Passed to the model, minus the ones the model is known to reject. Dropped values are listed in `x-plugboard-dropped-params`, as on Chat Completions (`dropUnsupportedParams`). |
| `top_k` | A non-negative integer, passed to the model. A model that refuses it (Claude Opus 4.7 and newer, every 5.x) or whose provider never sends it (GitHub Copilot, GPT-5 and 6) drops it, and `x-plugboard-dropped-params` lists `top_k`. |
| `stop_sequences` | Matched by plugboard on the answer text, and not sent to the model. See [Output](#output). |
| `thinking`, `output_config.effort` | `thinking` is validated like Anthropic does (`budget_tokens` at least 1024 and below `max_tokens`). It picks a model variant when the model has one and the id carries none: `output_config.effort` names the variant directly, otherwise `budget_tokens` up to 4096 means `low`, up to 16384 `medium`, above that `high`. A model without that variant gets the nearest one above it, or its highest one, so Haiku 4.5, which lists `high` and `max`, thinks on a small budget too. A model with no thinking variant at all runs without thinking, and the answer carries `x-plugboard-thinking: unavailable`. With `enabled` or `adaptive` thinking, the model's reasoning text comes back as `thinking` blocks. |
| `output_config.format` | `{"type": "json_schema", "schema": {...}}`: structured outputs. See [Structured outputs](#structured-outputs). |
| `stream` | The standard event sequence, below. |
| `metadata`, `service_tier`, `context_management`, `container` | Accepted and ignored. |

**System messages inside `messages` are lifted, not rejected.** Claude Code sends a `role: "system"` entry for models it does not know, and the real API refuses it. Plugboard moves each one out of `messages` and appends its text after the top-level `system`, in the order they were sent. The system prompt is therefore the top-level `system` first, then the lifted entries in their `messages` order. A lifted entry's `content` takes the same string or text-block forms as `system`.

## Thinking blocks

Plugboard replays a caller's `thinking` blocks (with a `signature`) and `redacted_thinking` blocks to an `anthropic` model, so the model keeps its earlier reasoning across turns. Copilot's Claude models (provider `github-copilot`, id `claude-*`) are replayed the same way. The signature is the provider's proof, so it is sent to no other provider: on any other model every thinking block is dropped, including other Copilot models.

An unsigned `thinking` block is dropped, since it has no signature to replay. Plugboard's own thinking blocks carry an empty signature when the host reports none, and such a block is not replayed.

## Prompt caching

A caller's `cache_control` breakpoint on a `text`, `image`, `document` or `tool_result` block is kept: the caller controls what is cached but cannot turn caching off. OpenCode fills the rest of its own budget. Anthropic allows four breakpoints per request, and the caller's breakpoints count against the same four. A caller's `ttl` is honoured only as described under TTL `1h` below. `cache_control` on `tools` is ignored, because the context hook can rewrite a tool's name, description and schema but not its cache hint.

**OpenCode's own breakpoints.** On the Anthropic Messages route, and on the OpenRouter and Vercel gateway routes for `anthropic/` models, OpenCode adds its breakpoints when the caller has not used the four slots: the last tool, the first and last system part, and the last text part of the last message (the conversation tail). All are 5-minute. A part that already has a breakpoint is skipped. Plugboard sends no cache policy, so this placement always runs. Other routes and models differ: Qwen gets system and tail breakpoints only, and some get none. The rest of this section describes the Claude placement.

**TTL `1h`.** A caller block with `ttl: "1h"` gets the 1-hour TTL only when the request has no tools. That means no caller `tools` and no server tools reach the model, or `tool_choice` is `none`. Then plugboard:

- gives 1h to every breakpoint before the last 1h block, including a caller's 5-minute block there (the raise adds no cost, see Pricing);
- gives 1h to the first and last system part and to the tail part, where OpenCode would otherwise put a 5-minute breakpoint before the 1h block, as far as the four slots allow;
- leaves a block after the last 1h block at 5 minutes.

The result keeps every 1-hour breakpoint before every 5-minute one. Anthropic requires that order: a 1-hour cache entry must appear before any 5-minute cache entry.

With tools, a 1h block is sent as 5 minutes. OpenCode's last-tool breakpoint is 5 minutes and comes before every message, so a 1h block could not come before it, and the context hook cannot set the tool's hint to 1h.

**Pricing.** Anthropic bills a 1-hour cache write at 2 times the base input price and a 5-minute write at 1.25 times. Reads cost the same. With mixed TTLs Anthropic bills a 1-hour write for every token up to the highest 1-hour breakpoint, whatever breakpoints come before it. So the caller's 1h block already prices everything before it as a 1-hour write, and raising an earlier 5-minute block to 1h adds no cost. Without the raise, Anthropic's order would be broken and the request rejected.

## What is refused

A 400 `invalid_request_error` whose message names the field, for example `tools.0.type: "web_search_20250305" is not supported`:

| Request | Why |
| --- | --- |
| Tools that are not custom tools | Server tools (`web_search`, `web_fetch`, `code_execution`, ...) run on Anthropic's side, and the versioned `computer`, `bash` and `text_editor` tools are not available. |
| `mcp_servers` | Not available. |
| An `output_config.format` that is not `{"type": "json_schema", "schema": {...}}`, one that comes with a tool named `respond` (plugboard answers through that name), and one that comes with a `tool_choice` naming a tool | See [Structured outputs](#structured-outputs). |
| Content blocks plugboard cannot use: `server_tool_use`, `web_search_tool_result`, `mcp_tool_use`, `search_result`, and so on | Provider-side features. |
| A `tool_result` whose `tool_use_id` no earlier `tool_use` block has, and `tool_choice` naming a tool that is not in `tools` | The conversation does not add up. |
| A missing `max_tokens`, `messages` or `model`, values out of range, and more tools than the `maxTools` option | Invalid request. |

A `file` source naming a file the app does not hold is a 404 `not_found_error` (see [Files API](files.md)).

## Counting tokens

`POST /v1/messages/count_tokens` answers `{ "input_tokens": N }`: an estimate of the input the session would send. It follows the request's path. Plugboard has no tokenizer for the model behind an id, so treat the count as a budget hint, not the provider's exact count. A Chat Completions or Responses request has no count endpoint.

The estimate is calibrated against Claude Haiku 4.5: about five characters per token, one token per CJK character, a fixed cost per request and per message, about 530 tokens for the tool-use preamble once tools are declared plus about 40 per tool and 35 per tool call or result, and each image at Anthropic's `width * height / 750` (after its downscaling to about 1.15 megapixels), read from the image header. An image whose size cannot be read, or a file, costs 1600. Expect it to be within about 20% for text, CJK, tools, transcripts and images of 32 to 1568 pixels a side.

The count includes:

- **System:** the app's `system` policy, the tool-choice steering, a skill's content for a skill alias, or an agent's prompt for `agent/<name>` (which replaces the caller's system prompt).
- **Tools:** the caller's tools the session offers (none for `tool_choice: none`, only the named one for a named choice, none with `tools: false`), and the app's `serverTools` schemas (none with `tool_choice: none`). With `output_config.format`, the schema is counted as the tool the model is given for it.

A refused request gets its refusal, not a size: a model outside the app's `models`, too many tools for `maxTools`, a server-tool name clash, a server tool the location does not offer or the operator's agent does not grant, and an unknown skill or agent.

A count for an app with a persona or `serverTools` has side effects, as the request has: the app directory is created, the Location may boot, and a backend that is not ready answers 503. Each such count also reads the app's tool and agent lists from OpenCode. Image downloads are not run, and the server-tool schemas are converted without OpenCode's draft-07 normalisation, so they can differ a little.

## Output

A message object: `id` (`msg_...`), `type: "message"`, `role: "assistant"`, `model`, `content` blocks in order (`thinking`, `text`, and one `tool_use` per call with an `id` starting `toolu_`), `stop_reason`, `stop_sequence` and `usage`.

| `stop_reason` | When |
| --- | --- |
| `end_turn` | The model stopped normally. |
| `tool_use` | The model called tools. |
| `max_tokens` | The model hit the token limit. |
| `refusal` | The provider filtered the content. |
| `stop_sequence` | The answer text contains one of the request's `stop_sequences`. |

On a `stop_sequences` match the answer ends at the first one: the text before it is returned, the sequence is removed and given as `stop_sequence`, and nothing after it is produced. Reasoning is never matched. A tool call before the sequence makes the turn a tool turn: `stop_reason` is `tool_use` and `stop_sequence` is `null`, as Anthropic reports a turn that ended on a call. `usage` is the usage of the run, also after a match.

`usage` has `input_tokens`, `output_tokens` (including reasoning), `cache_read_input_tokens` and `cache_creation_input_tokens`. As in Anthropic's API, `input_tokens` excludes the cached tokens that the other two fields report. The `x-plugboard-session` header works as on Chat Completions, and every response carries a `request-id` header.

Errors use Anthropic's body, `{"type":"error","error":{"type":"...","message":"..."}}`, from the first check on (auth, origin, body, model, provider errors), with these types:

| Type | Status |
| --- | --- |
| `invalid_request_error` | 400, 405, 415 |
| `authentication_error` | 401 |
| `permission_error` | 403 |
| `not_found_error` | 404 |
| `request_too_large` | 413 |
| `rate_limit_error` | 429 |
| `timeout_error` | 504 |
| `overloaded_error` | 529 |
| `api_error` | the rest |

The error object has no `code` or `param` field, as in Anthropic's API, so a full concurrency cap (429) is `rate_limit_error` with its message only, and `too_many_requests` is not sent here. A provider overload (the provider's own 529, or an `overloaded_error` in its message or body) is `overloaded_error` on HTTP 529, the status Anthropic clients retry with backoff. Other provider 503s stay `api_error` on 503. The OpenAI routes answer an overload as 503 `server_error` with code `provider_overloaded`.

## Streaming

`stream: true` sends SSE frames `event: <type>` then `data: <json>`:

```text
message_start                (usage is zero here: the host reports token counts only when the answer ends)
content_block_start          (thinking or text, one per block)
ping                         (once, after the first block starts)
content_block_delta          (thinking_delta or text_delta, one per model chunk)
content_block_stop
content_block_start          (tool_use with input {}, one per call)
content_block_delta          (one input_json_delta holding the whole input)
content_block_stop
message_delta                (stop_reason, and the final usage: input_tokens, cache_creation_input_tokens, cache_read_input_tokens and output_tokens)
message_stop
```

- **Tool calls** arrive whole from the model, so each call is a single `input_json_delta`.
- **Thinking blocks** carry the provider's `signature` when the host reports one (Anthropic's does), streamed as a `signature_delta` before the block stops. Otherwise the signature is empty.
- **Redacted reasoning.** A redacted reasoning block the provider returns comes back as one `redacted_thinking` block with its opaque `data` and no deltas. Like thinking, it is left out unless the request asked for thinking.
- **Tool names in reasoning.** Reasoning text that names a tool by its internal placeholder id is rewritten to the tool's name before it leaves plugboard.
- **Failures.** Nothing is sent until there is output, so a failure before the first token is a real HTTP error. A failure after that ends the stream with an `event: error` frame (`{"type":"error","error":{"type","message"}}`) and no `message_stop`.

## Structured outputs

`output_config.format` takes `{"type": "json_schema", "schema": {...}}` and answers with JSON as one `text` block and `stop_reason: "end_turn"`, as Anthropic does. A stream sends the JSON as a single `text_delta`.

```python
import json
import os

import anthropic

client = anthropic.Anthropic(base_url="http://localhost:4010", api_key=os.environ["PLUGBOARD_KEY"])

schema = {
    "type": "object",
    "properties": {"vendor": {"type": "string"}, "total": {"type": "number"}},
    "required": ["vendor", "total"],
    "additionalProperties": False,
}
r = client.messages.create(
    model="fast",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Invoice from Acme, total 120.50 EUR"}],
    output_config={"format": {"type": "json_schema", "schema": schema}},
)
data = json.loads(r.content[0].text)
```

Plugboard maps it to the path Chat Completions uses for `json_schema`: the model is given a forced tool named `respond` whose input schema is yours, and the tool call's input becomes the text. The rules are the same as there:

- **The schema is not enforced.** Anthropic constrains decoding. Here the model is asked for the schema and the answer is passed on, so validate it. A schema other than an object is sent as it is.
- **A model that answers in text.** If the model skips the tool and its final text is the JSON the schema asks for (one code fence is stripped), that text is the answer. A non-streamed response then carries `x-plugboard-structured-fallback: text`. The check covers the top-level `type`, the top-level `required` keys and the `type` of each top-level property.
- **No answer.** A turn with neither the tool call nor matching text is a 502 `api_error` whose message says the model did not return JSON matching the response schema, for any finish reason. A stream is committed by its first event (the answer is held back until the turn ends), so there the failure is an `event: error` frame and no `message_stop`.
- **Caller tools.** With `tools`, the model may call one of them or answer. A call to one of your tools is a normal `tool_use` turn, and the structured answer is dropped. `tool_choice: none` leaves only the answer.
- **Refused.** A `tool_choice` that names a tool, and a tool named `respond`, are 400s.
- **Thinking.** `thinking` blocks still come first when the request asked for thinking.
- **Token counts.** `count_tokens` counts the request the model gets, including the tool.
- **Not covered.** Prefilling and citations next to `output_config.format` are not checked.

## Structured extraction with a forced tool

An alternative for clients that already define their schema as a tool: define a tool whose `input_schema` is the schema you want, and set `tool_choice` to that tool. The `input` of the tool call is the answer.

Plugboard applies a named `tool_choice` as an instruction, because the OpenCode session has no tool-choice control. So the model can still answer in text. Handle a reply with no `tool_use` block, and check the input against the schema in your own code: the schema is not enforced, the same as `json_schema` on the other routes.

Python, with pydantic:

```python
import os

import anthropic
from pydantic import BaseModel


class Invoice(BaseModel):
    vendor: str
    total: float
    currency: str | None = None


client = anthropic.Anthropic(base_url="http://localhost:4010", api_key=os.environ["PLUGBOARD_KEY"])


def extract_invoice(text: str) -> Invoice:
    r = client.messages.create(
        model="fast",
        max_tokens=1024,
        tools=[{"name": "record_invoice", "description": "Record the invoice.", "input_schema": Invoice.model_json_schema()}],
        tool_choice={"type": "tool", "name": "record_invoice"},
        messages=[{"role": "user", "content": text}],
    )
    calls = [b for b in r.content if b.type == "tool_use"]
    if not calls:
        raise ValueError("the model answered in text, not with record_invoice")
    return Invoice.model_validate(calls[0].input)  # the schema is not enforced: validate here
```

TypeScript:

```ts
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ baseURL: "http://localhost:4010", apiKey: process.env.PLUGBOARD_KEY })

const invoiceSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    vendor: { type: "string" },
    total: { type: "number" },
    currency: { type: ["string", "null"] },
  },
  required: ["vendor", "total"],
}

export async function extractInvoice(text: string): Promise<unknown> {
  const r = await client.messages.create({
    model: "fast",
    max_tokens: 1024,
    tools: [{ name: "record_invoice", description: "Record the invoice.", input_schema: invoiceSchema }],
    tool_choice: { type: "tool", name: "record_invoice" },
    messages: [{ role: "user", content: text }],
  })
  const call = r.content.find((b) => b.type === "tool_use")
  if (call?.type !== "tool_use") throw new Error("the model answered in text, not with record_invoice")
  return call.input // the schema is not enforced: validate before use
}
```
