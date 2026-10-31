/**
 * The byte accounting of the request log line (`src/request-size.ts`): counts, UTF-8 sizes of the JSON of each part, the body size as
 * it arrived, and the sum over the prompts of one body.
 */
import { describe, expect, test } from "bun:test"
import type { PlugRequest } from "../../src/contract.js"
import { noteSizes, requestSizes, type SizeInfo } from "../../src/request-size.js"

const request = (parts: Partial<Pick<PlugRequest, "system" | "messages" | "tools">>): Pick<PlugRequest, "system" | "messages" | "tools"> => ({ system: [], messages: [], tools: [], ...parts })

describe("request sizes", () => {
  test("counts system prompts, messages and tools, and the UTF-8 size of each part's JSON", () => {
    const sizes = requestSizes(900, [
      request({
        system: ["be brief"],
        messages: [{ role: "user", content: [{ type: "text", text: "é" }] }],
        tools: [{ name: "a", description: "d", parameters: {} }],
      }),
    ])
    expect(sizes).toEqual({
      body_bytes: 900,
      system_count: 1,
      system_bytes: 12, // ["be brief"]
      message_count: 1,
      message_bytes: 57, // [{"role":"user","content":[{"type":"text","text":"é"}]}], 56 characters and one of them two bytes
      tool_count: 1,
      tool_bytes: 48, // [{"name":"a","description":"d","parameters":{}}]
    })
  })

  test("a part the request did not send is zero bytes, not the two bytes of an empty list", () => {
    expect(requestSizes(2, [request({})])).toEqual({ body_bytes: 2, system_count: 0, system_bytes: 0, message_count: 0, message_bytes: 0, tool_count: 0, tool_bytes: 0 })
  })

  test("the prompts of one body add up", () => {
    const tool = { name: "a", description: "d", parameters: {} }
    const sizes = requestSizes(10, [request({ system: ["x"], tools: [tool] }), request({ system: ["y", "z"], tools: [tool, tool] })])
    expect(sizes).toMatchObject({ system_count: 3, system_bytes: 5 + 9, tool_count: 3, tool_bytes: 48 + 95 })
  })

  test("noteSizes records the body's own length, and records nothing for a body it never saw", () => {
    const seen: SizeInfo = { body: Buffer.from('{"a":1}') }
    noteSizes(seen, request({ system: ["x"] }))
    expect(seen.sizes?.body_bytes).toBe(7)
    const unseen: SizeInfo = {}
    noteSizes(unseen, request({ system: ["x"] }))
    expect(unseen.sizes).toBeUndefined()
  })
})
