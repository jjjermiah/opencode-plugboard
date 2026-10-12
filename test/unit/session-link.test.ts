/**
 * Session links (#77): option `historyUrl` is validated when the config loads (an http(s) template with
 * `{id}`, and no placeholder but `{directory}`), and the template fills with the id and directory,
 * URL-encoded (src/session/link.ts).
 */
import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"
import { sessionUrl } from "../../src/session/link.js"

describe("#77 option historyUrl: validated at load", () => {
  test.each([
    "http://opencode.lan:4096/session/{id}",
    "https://ops.example/{directory}/session/{id}",
  ])("#77 %s is accepted", (historyUrl) => {
    expect(parseOptions({ historyUrl }).historyUrl).toBe(historyUrl)
  })

  test("#77 without the option no link is configured", () => {
    expect(parseOptions({}).historyUrl).toBeUndefined()
  })

  test.each([
    ["http://opencode.lan:4096/session/", "must be a URL template with {id}"],
    [5, "must be a URL template with {id}"],
    ["ftp://opencode.lan/session/{id}", "must be http or https"],
    ["not a url {id}", "must be an http(s) URL template"],
    ["http://opencode.lan/{sesion}/{id}", "unknown placeholder {sesion}"],
  ])("#77 %j is refused with an actionable message", (historyUrl, message) => {
    expect(() => parseOptions({ historyUrl })).toThrow(message)
  })
})

describe("#77 the template fills with the id and directory", () => {
  test("#77 {id} is the session id", () => {
    expect(sessionUrl("http://opencode.lan:4096/session/{id}", "ses_abc")).toBe("http://opencode.lan:4096/session/ses_abc")
  })

  test("#77 {directory} is URL-encoded, so a path cannot add segments or a query", () => {
    expect(sessionUrl("http://h/{directory}/session/{id}", "ses_1", "/data/app")).toBe("http://h/%2Fdata%2Fapp/session/ses_1")
    expect(sessionUrl("http://h/session/{id}", "ses_1?x=1#y")).toBe("http://h/session/ses_1%3Fx%3D1%23y")
  })
})
