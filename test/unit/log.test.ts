/** #76 the logger: text and JSON lines, and the ambient request id. */
import { afterEach, describe, expect, test } from "bun:test"
import { errorMessage, log, logDebug, logError, logRequest, logWarn, outsideRequest, setLogFormat, setLogLevel, setLogRequests, withRequestId } from "../../src/log.js"
import { captureLogs } from "../support/logs.js"

const logs = captureLogs()
afterEach(() => {
  setLogFormat("text")
  setLogLevel("info")
  setLogRequests(true)
})

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

  test("#126 json is pino's: level is a name, the base holds only the service, info goes to stdout", () => {
    setLogFormat("json")
    log("x", { time: "spoof", service: "spoof" })
    const line = JSON.parse(logs.lines[0]!.raw)
    expect(Object.keys(line).sort()).toEqual(["event", "level", "service", "time"])
    expect(line).toMatchObject({ level: "info", service: "opencode-plugboard", event: "x" })
    expect(Date.parse(line.time)).not.toBeNaN()
    expect(logs.lines[0]!.level).toBe("log")
  })

  test.each(["text", "json"] as const)("#126 %s: credential fields are censored, at the top level and under headers", (format) => {
    setLogFormat(format)
    log("x", { authorization: "Bearer sk-1", "x-api-key": "sk-2", "x-goog-api-key": "sk-3", key: "sk-4", ok: true })
    logError("y", { headers: undefined, Authorization: "Bearer sk-5" })
    const text = logs.lines.map((line) => line.raw).join("\n")
    expect(text).not.toMatch(/sk-\d/)
    expect(text.match(/\[redacted\]/g)).toHaveLength(5)
    expect(text).toContain("ok")
  })

  test("#126 a header object is censored too", () => {
    setLogFormat("json")
    log("x", { headers: { authorization: "Bearer sk-1", "x-api-key": "sk-2", accept: "a" } } as never)
    expect(JSON.parse(logs.lines[0]!.raw).headers).toEqual({ authorization: "[redacted]", "x-api-key": "[redacted]", accept: "a" })
  })

  test("json carries the ambient request id too", () => {
    setLogFormat("json")
    withRequestId("req9", () => log("inside"))
    expect(JSON.parse(logs.lines[0]!.raw)).toMatchObject({ event: "inside", id: "req9" })
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

/** #262 `logLevel` and `logRequests`: volume switches. Neither changes what a written line holds. */
describe("#262 log level and access lines", () => {
  test("at error, an info line is dropped and an error line is written", () => {
    setLogLevel("error")
    log("request", { status: 200 })
    logWarn("budget.warn", { app: "a" })
    logError("request.failed", { status: 500 })
    expect(logs.lines.map((line) => line.event)).toEqual(["request.failed"])
  })

  test("at warn, info is dropped but a warning is kept", () => {
    setLogLevel("warn")
    log("request", { status: 200 })
    logWarn("budget.warn", { app: "a" })
    expect(logs.lines.map((line) => line.event)).toEqual(["budget.warn"])
  })

  test("at debug, a debug line is written to stdout", () => {
    setLogLevel("debug")
    logDebug("location.keepalive", { outcome: "ok" })
    expect(logs.lines).toHaveLength(1)
    expect(logs.lines[0]).toMatchObject({ level: "log", event: "location.keepalive" })
  })

  test("at info (the default), a debug line is dropped", () => {
    logDebug("location.keepalive", { outcome: "ok" })
    expect(logs.lines).toHaveLength(0)
  })

  test("logRequests off drops the access line and keeps an error line", () => {
    setLogRequests(false)
    logRequest("request", { status: 200 })
    logError("request.failed", { status: 500 })
    expect(logs.lines.map((line) => line.event)).toEqual(["request.failed"])
  })

  test("logRequests off keeps a warning (only the access lines are switched)", () => {
    setLogRequests(false)
    logWarn("budget.warn", { app: "a" })
    expect(logs.lines.map((line) => line.event)).toEqual(["budget.warn"])
  })

  test("with logRequests on (the default), the access line is written as before", () => {
    logRequest("request", { status: 200 })
    expect(logs.lines[0]!.raw).toBe("[opencode-plugboard] request status=200")
  })

  test("the redaction holds at debug (#126)", () => {
    setLogLevel("debug")
    setLogFormat("json")
    logDebug("x", { authorization: "Bearer sk-9" })
    expect(logs.lines.map((line) => line.raw).join("")).not.toMatch(/sk-9/)
  })
})
