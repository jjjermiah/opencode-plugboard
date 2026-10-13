/**
 * The harness decides whether a stream ended normally from the captured wire, not from the runner's `done` flag (#370).
 */
import { describe, expect, test } from "bun:test"
import { streamEnded, streamsEnded } from "../../examples/_harness/run.ts"

const chat = "/v1/chat/completions"

describe("#370 a stream ended normally on the wire", () => {
  test("chat completions: the last frame is data: [DONE]", () => {
    expect(streamEnded({ path: chat, resBody: 'data: {"id":"1"}\n\ndata: {"id":"2"}\n\ndata: [DONE]\n\n' })).toBe(true)
  })

  test("chat completions: a stream cut off before [DONE] did not end", () => {
    expect(streamEnded({ path: chat, resBody: 'data: {"id":"1"}\n\ndata: {"id":"2"}\n\n' })).toBe(false)
  })

  test("Responses: the last event is response.completed", () => {
    const body = "event: response.created\ndata: {}\n\nevent: response.output_text.delta\ndata: {}\n\nevent: response.completed\ndata: {}\n\n"
    expect(streamEnded({ path: "/v1/responses", resBody: body })).toBe(true)
    expect(streamEnded({ path: "/v1/responses", resBody: body.split("event: response.completed")[0]! })).toBe(false)
  })

  test("Messages: the last event is message_stop", () => {
    const body = "event: message_start\ndata: {}\n\nevent: content_block_delta\ndata: {}\n\nevent: message_stop\ndata: {}\n\n"
    expect(streamEnded({ path: "/v1/messages", resBody: body })).toBe(true)
    expect(streamEnded({ path: "/v1/messages", resBody: body.split("event: message_stop")[0]! })).toBe(false)
  })

  test("Gemini: the last chunk carries a finishReason", () => {
    const done = 'data: {"candidates":[{"content":{},"finishReason":"STOP"}]}\n\n'
    expect(streamEnded({ path: "/v1beta/models/fast:streamGenerateContent", resBody: done })).toBe(true)
    expect(streamEnded({ path: "/v1beta/models/fast:streamGenerateContent", resBody: 'data: {"candidates":[{"content":{}}]}\n\n' })).toBe(false)
  })

  test("a route with no known terminal event, or a plain JSON answer, did not end", () => {
    expect(streamEnded({ path: "/v1/models", resBody: "data: [DONE]" })).toBe(false)
    expect(streamEnded({ path: chat, resBody: '{"choices":[]}' })).toBe(false)
  })

  test("a row needs at least one stream, and every stream must end", () => {
    expect(streamsEnded([])).toBe(false)
    expect(streamsEnded([{ path: chat, resBody: "data: [DONE]\n\n" }, { path: chat, resBody: "data: {}\n\n" }])).toBe(false)
    expect(streamsEnded([{ path: chat, resBody: "data: [DONE]\n\n" }])).toBe(true)
  })

  test("a capture cut inside the terminal event did not end, even when its text is complete", () => {
    expect(streamEnded({ path: chat, resBody: 'data: {"id":"1"}\n\ndata: [DONE]' })).toBe(false)
    expect(streamEnded({ path: "/v1/messages", resBody: "event: message_stop\ndata: {}" })).toBe(false)
  })

  test("Gemini reads the candidate's finishReason, not the word in the text", () => {
    const spelledInText = 'data: {"candidates":[{"content":{"parts":[{"text":"finishReason"}]}}]}\n\n'
    expect(streamEnded({ path: "/v1beta/models/fast:streamGenerateContent", resBody: spelledInText })).toBe(false)
  })
})
