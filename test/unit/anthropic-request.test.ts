import { describe, expect, test } from "bun:test"
import { parseMessagesRequest, type ParsedMessages } from "../../src/anthropic/request.js"
import { isPlugError } from "../../src/contract.js"
import { testOptions } from "../support/fixtures.js"

const options = testOptions({ maxTools: 2 })
const user = (content: unknown = "hi") => ({ role: "user", content })
const assistant = (content: unknown) => ({ role: "assistant", content })
const body = (extra: Record<string, unknown> = {}) => ({ model: "test/echo", max_tokens: 100, messages: [user()], ...extra })
const tool = (name: string, extra: Record<string, unknown> = {}) => ({ name, input_schema: { type: "object" }, ...extra })
const toolUse = (id: string, name: string, input: unknown = {}) => ({ type: "tool_use", id, name, input })
const image = (source: unknown) => ({ type: "image", source })

describe("#275 cache_control on content blocks", () => {
  test("an ephemeral breakpoint on a text, image or tool_result block is carried as a caller breakpoint; its ttl is not", () => {
    const cache = { type: "ephemeral", ttl: "1h" }
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    const { request } = parse(
      body({
        messages: [
          { role: "user", content: [{ type: "text", text: "big context", cache_control: cache }, { type: "image", source: { type: "base64", media_type: "image/png", data: png }, cache_control: { type: "ephemeral" } }] },
          assistant([{ type: "text", text: "ok", cache_control: cache }, toolUse("t1", "read")]),
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "data", cache_control: { type: "ephemeral" } }] },
        ],
      }),
    )
    expect(request.messages[0]!.content).toEqual([{ type: "text", text: "big context", cache: true }, { type: "media", url: `data:image/png;base64,${png}`, mediaType: "image/png", cache: true }])
    expect(request.messages[1]!.content[0]).toEqual({ type: "text", text: "ok", cache: true })
    expect(request.messages[2]!.content).toEqual([{ type: "tool-result", id: "t1", name: "read", result: "data", cache: true }])
  })

  test("a block without cache_control carries no cache field", () => {
    const { request } = parse(body({ messages: [user("plain")] }))
    expect(request.messages[0]!.content[0]).not.toHaveProperty("cache")
  })
})

describe("#202 disable_parallel_tool_use", () => {
  test("tool_choice.disable_parallel_tool_use true asks for one tool call per answer; false and absent do not", () => {
    const tools = [tool("a")]
    expect(parse(body({ tools, tool_choice: { type: "auto", disable_parallel_tool_use: true } })).request.parallelToolCalls).toBe(false)
    expect(parse(body({ tools, tool_choice: { type: "any", disable_parallel_tool_use: false } })).request).not.toHaveProperty("parallelToolCalls")
    expect(parse(body({ tools, tool_choice: { type: "auto" } })).request).not.toHaveProperty("parallelToolCalls")
  })
})

function parse(raw: unknown): ParsedMessages {
  const parsed = parseMessagesRequest(raw, options)
  if (isPlugError(parsed)) throw new Error(`unexpected rejection: ${parsed.message}`)
  return parsed
}

describe("#4 parseMessagesRequest: rejections are 400s whose message names the field the Anthropic way", () => {
  const rejections: Array<[string, unknown, RegExp]> = [
    ["a body that is not an object", [], /must be a JSON object/],
    ["a missing model", { max_tokens: 1, messages: [user()] }, /^model: Field required/],
    ["a missing max_tokens", { model: "m", messages: [user()] }, /^max_tokens: Field required/],
    ["a fractional max_tokens", body({ max_tokens: 1.5 }), /^max_tokens: must be an integer/],
    ["max_tokens 0", body({ max_tokens: 0 }), /^max_tokens: must be at least 1/],
    ["a non-boolean stream", body({ stream: "yes" }), /^stream: must be a boolean/],
    ["mcp_servers", body({ mcp_servers: [{ url: "x" }] }), /^mcp_servers: not supported/],
    ["missing messages", { model: "m", max_tokens: 1 }, /^messages: Field required/],
    ["empty messages", body({ messages: [] }), /^messages: must be a non-empty array/],
    ["a message that is not an object", body({ messages: ["hi"] }), /^messages\.0: must be an object/],
    ["an unknown role", body({ messages: [{ role: "tool", content: "x" }] }), /^messages\.0\.role/],
    ["missing content", body({ messages: [{ role: "user" }] }), /^messages\.0\.content: Field required/],
    ["content of the wrong type", body({ messages: [user(5)] }), /^messages\.0\.content: must be a string or an array/],
    ["a text block without text", body({ messages: [user([{ type: "text" }])] }), /^messages\.0\.content\.0\.text/],
    ["an unsupported user block", body({ messages: [user([{ type: "search_result" }])] }), /^messages\.0\.content\.0\.type: "search_result" is not supported/],
    ["an image without source", body({ messages: [user([{ type: "image" }])] }), /^messages\.0\.content\.0\.source: Field required/],
    ["an image with a bad media type", body({ messages: [user([image({ type: "base64", media_type: "png", data: "AA" })])] }), /source\.media_type/],
    ["an image by file id", body({ messages: [user([image({ type: "file", file_id: "f" })])] }), /source\.type: "file" is not supported for image blocks/],
    ["an assistant block that is not text or tool_use", body({ messages: [user(), assistant([{ type: "server_tool_use" }])] }), /^messages\.1\.content\.0\.type/],
    ["a tool_use without id", body({ messages: [user(), assistant([{ type: "tool_use", name: "f" }])] }), /^messages\.1\.content\.0\.id: Field required/],
    ["a tool_use with a non-object input", body({ messages: [user(), assistant([toolUse("t1", "f", "x")])] }), /^messages\.1\.content\.0\.input: must be an object/],
    ["a tool_result for an unknown tool_use", body({ messages: [user([{ type: "tool_result", tool_use_id: "nope", content: "x" }])] }), /matches no tool_use block/],
    ["a tool_result with an unsupported block", body({ messages: [user(), assistant([toolUse("t1", "f")]), user([{ type: "tool_result", tool_use_id: "t1", content: [{ type: "audio" }] }])] }), /is not supported in tool_result content/],
    ["a system that is not text blocks", body({ system: [{ type: "image" }] }), /^system\.0: must be a text block/],
    ["tools that are not an array", body({ tools: {} }), /^tools: must be an array/],
    ["a server tool", body({ tools: [{ type: "web_search_20250305", name: "web_search" }] }), /^tools\.0\.type: "web_search_20250305" is not supported/],
    ["a tool without input_schema", body({ tools: [{ name: "f" }] }), /^tools\.0\.input_schema: Field required/],
    ["a duplicate tool", body({ tools: [tool("f"), tool("f")] }), /^tools\.1\.name: duplicate tool name/],
    ["more tools than maxTools", body({ tools: [tool("a"), tool("b"), tool("c")] }), /^tools: 3 tools; plugboard allows 2/],
    ["a tool_choice that is not an object", body({ tool_choice: "auto" }), /^tool_choice: must be an object/],
    ["an unknown tool_choice type", body({ tool_choice: { type: "all" } }), /^tool_choice\.type/],
    ["tool_choice any without tools", body({ tool_choice: { type: "any" } }), /^tool_choice: needs at least one tool/],
    ["a tool_choice naming a missing tool", body({ tools: [tool("a")], tool_choice: { type: "tool", name: "b" } }), /^tool_choice\.name: "b" is not in tools/],
    ["temperature above 1 (Anthropic's range)", body({ temperature: 1.5 }), /^temperature: must be between 0 and 1/],
    ["a negative top_k", body({ top_k: -1 }), /^top_k: must be a non-negative integer/],
    ["an empty stop sequence", body({ stop_sequences: [""] }), /^stop_sequences/],
    ["thinking that is not an object", body({ thinking: true }), /^thinking: must be an object/],
    ["a thinking budget below 1024", body({ max_tokens: 5000, thinking: { type: "enabled", budget_tokens: 1000 } }), /at least 1024/],
    ["a thinking budget not below max_tokens", body({ max_tokens: 2000, thinking: { type: "enabled", budget_tokens: 2000 } }), /less than max_tokens/],
    ["an unknown thinking type", body({ thinking: { type: "on" } }), /^thinking\.type/],
    ["output_config.format (structured outputs)", body({ output_config: { format: { type: "json_schema" } } }), /^output_config\.format: structured outputs are not supported/],
  ]
  test.each(rejections)("rejects %s", (_name, raw, message) => {
    const parsed = parseMessagesRequest(raw, options)
    expect(parsed).toMatchObject({ status: 400, kind: "invalid_request" })
    expect((parsed as { message: string }).message).toMatch(message)
  })
})

describe("#4 parseMessagesRequest: content mapping", () => {
  test("a string system and string content", () => {
    const { request } = parse(body({ system: "be brief" }))
    expect(request.system).toEqual(["be brief"])
    expect(request.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }])
    expect(request.generation).toEqual({ maxTokens: 100 })
  })

  test("system text blocks (cache_control ignored); empty ones dropped", () => {
    expect(parse(body({ system: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }, { type: "text", text: "" }] })).request.system).toEqual(["a"])
  })

  test("Claude Code's system-role messages are lifted into the system prompt after the top-level system", () => {
    const { request } = parse(body({ system: "top", messages: [{ role: "system", content: "lifted" }, user()] }))
    expect(request.system).toEqual(["top", "lifted"])
    expect(request.messages).toHaveLength(1)
  })

  test("image and document blocks: base64 becomes a data URL, url passes through, a text document becomes text", () => {
    const { request } = parse(
      body({
        messages: [
          user([
            image({ type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" }),
            image({ type: "url", url: "https://example.com/a.png" }),
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBE" } },
            { type: "document", source: { type: "text", media_type: "text/plain", data: "plain doc" } },
            { type: "text", text: "" },
          ]),
        ],
      }),
    )
    expect(request.messages[0]!.content).toEqual([
      { type: "media", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", mediaType: "image/png" },
      { type: "media", url: "https://example.com/a.png" },
      { type: "media", url: "data:application/pdf;base64,JVBE", mediaType: "application/pdf" },
      { type: "text", text: "plain doc" },
    ])
  })

  test("#146 a replayed thinking block is dropped whatever its signature, so the empty signature plugboard sends never reaches a provider", () => {
    const { request } = parse(
      body({
        messages: [
          user("look"),
          assistant([{ type: "thinking", thinking: "hidden", signature: "" }, { type: "redacted_thinking", data: "opaque" }, { type: "text", text: "done" }]),
          user("again"),
        ],
      }),
    )
    expect(request.messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "done" }] })
  })

  test("a tool round trip: tool_use becomes a call, each tool_result its own tool message, result images follow as user media", () => {
    const { request } = parse(
      body({
        messages: [
          user("look"),
          assistant([{ type: "thinking", thinking: "hidden", signature: "s" }, { type: "text", text: "checking" }, toolUse("t1", "shot", { x: 1 }), toolUse("t2", "read")]),
          user([
            { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "took it" }, image({ type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" })] },
            { type: "tool_result", tool_use_id: "t2", content: "boom", is_error: true },
            { type: "text", text: "now explain" },
          ]),
        ],
      }),
    )
    expect(request.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "look" }] },
      { role: "assistant", content: [{ type: "text", text: "checking" }, { type: "tool-call", id: "t1", name: "shot", input: { x: 1 } }, { type: "tool-call", id: "t2", name: "read", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", id: "t1", name: "shot", result: "took it" }] },
      { role: "tool", content: [{ type: "tool-result", id: "t2", name: "read", result: "boom", isError: true }] },
      {
        role: "user",
        content: [{ type: "text", text: "Images returned by the tool calls above:" }, { type: "media", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", mediaType: "image/png" }, { type: "text", text: "now explain" }],
      },
    ])
  })
})

describe("#4 parseMessagesRequest: tools, sampling and thinking", () => {
  test.each([
    ["auto", { type: "auto" }, "auto"],
    ["any", { type: "any" }, "required"],
    ["none", { type: "none" }, "none"],
    ["tool", { type: "tool", name: "a" }, { type: "tool", name: "a" }],
  ])("tool_choice type %s maps to the neutral choice", (_name, choice, expected) => {
    expect(parse(body({ tools: [tool("a")], tool_choice: choice })).request.toolChoice).toEqual(expected as never)
  })

  test("custom tools map to neutral tools; type custom is accepted", () => {
    expect(parse(body({ tools: [tool("a", { type: "custom", description: "A" })] })).request.tools).toEqual([{ name: "a", description: "A", parameters: { type: "object" } }])
  })

  test("sampling and stop sequences map; top_k is accepted and reported as ignored", () => {
    const parsed = parse(body({ temperature: 0.5, top_p: 0.9, top_k: 40, stop_sequences: ["END"] }))
    expect(parsed.request.generation).toEqual({ maxTokens: 100, temperature: 0.5, topP: 0.9, stop: ["END"] })
    expect(parsed.topKIgnored).toBe(true)
    expect(parse(body()).topKIgnored).toBe(false)
  })

  test.each([
    [1024, "low"],
    [4096, "low"],
    [4097, "medium"],
    [16384, "medium"],
    [16385, "high"],
  ])("a thinking budget of %d asks for variant %s and returns thinking blocks", (budget, effort) => {
    const parsed = parse(body({ max_tokens: 64_000, thinking: { type: "enabled", budget_tokens: budget } }))
    expect(parsed.reasoningEffort).toBe(effort)
    expect(parsed.exchange.thinking).toBe(true)
  })

  test("adaptive thinking returns thinking blocks without a variant; output_config.effort names one", () => {
    expect(parse(body({ thinking: { type: "adaptive" } }))).toMatchObject({ exchange: { thinking: true } })
    expect(parse(body({ thinking: { type: "adaptive" } }))).not.toHaveProperty("reasoningEffort")
    expect(parse(body({ output_config: { effort: "max" } })).reasoningEffort).toBe("max")
  })

  test("the exchange echoes the client's model and stream flag", () => {
    expect(parse(body({ stream: true })).exchange).toEqual({ model: "test/echo", stream: true, thinking: false })
  })
})
