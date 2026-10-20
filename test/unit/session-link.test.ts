/**
 * Session links (#77): option `sessionUrl` is validated when the config loads (an http(s) template with
 * `{id}`, and no placeholder but `{directory}`), and the template fills with the id and directory,
 * URL-encoded (src/session/link.ts).
 */
import { describe, expect, test } from "bun:test"
import { historyTemplate, parseOptions } from "../../src/config.js"
import { sessionUrl } from "../../src/session/link.js"

describe("#77 option sessionUrl: validated at load", () => {
  test.each(["http://opencode.lan:4096/session/{id}", "https://ops.example/{directory}/session/{id}"])("#77 %s is accepted", (sessionUrl) => {
    expect(parseOptions({ sessionUrl }).sessionUrl).toBe(sessionUrl)
  })

  test("#77 without the option no link is configured", () => {
    expect(parseOptions({}).sessionUrl).toBeUndefined()
  })

  test.each([
    ["http://opencode.lan:4096/session/", "must be a URL template with {id}"],
    [5, "must be a URL template with {id}"],
    ["ftp://opencode.lan/session/{id}", "must be http or https"],
    ["not a url {id}", "must be an http(s) URL template"],
    ["http://opencode.lan/{sesion}/{id}", "unknown placeholder {sesion}"],
  ])("#77 %j is refused with an actionable message", (sessionUrl, message) => {
    expect(() => parseOptions({ sessionUrl })).toThrow(message)
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

describe("#280 option apps.<name>.sessionUrl: a per-app template, or false for none", () => {
  const GLOBAL = "http://global.lan:4096/session/{id}"
  const own = (value: unknown) => parseOptions({ sessionUrl: GLOBAL, keys: { alpha: "ka" }, apps: { alpha: { sessionUrl: value } } })

  test("#280 an app's own template, and false, are accepted and stored on its policy", () => {
    expect(own("http://alpha.lan/s/{id}").apps.alpha!.sessionUrl).toBe("http://alpha.lan/s/{id}")
    expect(own(false).apps.alpha!.sessionUrl).toBe(false)
  })

  test.each([
    ["a template without {id}", "http://alpha.lan/session", "`apps.alpha.sessionUrl` must be a URL template with {id}"],
    ["a non-http scheme", "ftp://alpha.lan/{id}", "`apps.alpha.sessionUrl` must be http or https"],
    ["an unknown placeholder", "http://alpha.lan/{id}/{sesion}", "`apps.alpha.sessionUrl` has the unknown placeholder {sesion}"],
    ["a non-string, non-false value", true, "`apps.alpha.sessionUrl` must be a URL template with {id}"],
  ])("#280 %s is refused at load, naming the app's option", (_name, value, message) => {
    expect(() => own(value)).toThrow(message)
  })

  test("#280 historyTemplate: an app's own template, none for false, the global one when unset", () => {
    const options = parseOptions({
      sessionUrl: GLOBAL,
      keys: { alpha: "ka", beta: "kb", gamma: "kc" },
      apps: { alpha: { sessionUrl: "http://alpha.lan/s/{id}" }, beta: { sessionUrl: false }, gamma: { tools: false } },
    })
    expect(historyTemplate(options, "alpha")).toBe("http://alpha.lan/s/{id}")
    expect(historyTemplate(options, "beta")).toBeUndefined()
    expect(historyTemplate(options, "gamma")).toBe(GLOBAL)
    expect(historyTemplate(options, "unknown")).toBe(GLOBAL)
  })

  test("#280 with no global sessionUrl, an app's own template still applies and others get none", () => {
    const options = parseOptions({ keys: { alpha: "ka", beta: "kb" }, apps: { alpha: { sessionUrl: "http://alpha.lan/s/{id}" } } })
    expect(historyTemplate(options, "alpha")).toBe("http://alpha.lan/s/{id}")
    expect(historyTemplate(options, "beta")).toBeUndefined()
  })
})
