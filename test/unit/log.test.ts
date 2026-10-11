/** #76 the logger: text and JSON lines, and the ambient request id. */
import { afterEach, describe, expect, test } from "bun:test"
import { errorMessage, log, logError, outsideRequest, setLogFormat, withRequestId } from "../../src/log.js"
import { captureLogs } from "../support/logs.js"

const logs = captureLogs()
afterEach(() => setLogFormat("text"))

describe("#76 log lines", () => {
  test("text: event then key=value, quoting values that need it, skipping undefined", () => {
    log("request", { route: "POST /v1/chat/completions", status: 200, app: undefined, ok: true })
    expect(logs.lines[0]!.raw).toBe('[opencode-plugboard] request route="POST /v1/chat/completions" status=200 ok=true')
  })

  test("errors go to stderr", () => {
    logError("request.failed", { status: 500 })
    expect(logs.lines[0]).toMatchObject({ level: "error", event: "request.failed" })
  })

  test("json: one object per line; envelope keys cannot be overwritten by fields", () => {
    setLogFormat("json")
    logError("x", { level: "info", event: "spoof", n: 1 })
    const line = JSON.parse(logs.lines[0]!.raw)
    expect(line).toMatchObject({ level: "error", service: "opencode-plugboard", event: "x", n: 1 })
    expect(Date.parse(line.time)).not.toBeNaN()
  })

  test("a line written while a request runs carries its id, across awaits; an explicit id wins", async () => {
    await withRequestId("req123", async () => {
      await Promise.resolve()
      log("inside")
      log("explicit", { id: "other" })
      outsideRequest(() => log("detached"))
    })
    log("after")
    expect(logs.lines.map((line): unknown[] => [line.event, line.fields.id])).toEqual([
      ["inside", "req123"],
      ["explicit", "other"],
      ["detached", undefined],
      ["after", undefined],
    ])
  })

  test("errorMessage keeps only the message", () => {
    expect(errorMessage(Object.assign(new Error("boom"), { secret: "x" }))).toBe("boom")
    expect(errorMessage("plain")).toBe("plain")
  })
})
