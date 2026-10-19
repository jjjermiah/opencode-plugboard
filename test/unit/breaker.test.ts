/**
 * The circuit breaker state machine (src/breaker.ts): closed, open, half open, and back. Time is a clock the test moves,
 * so nothing here sleeps.
 */
import { describe, expect, test } from "bun:test"
import { createBreaker } from "../../src/breaker.js"
import { DEFAULT_FALLBACK_COOLDOWN, type FallbackCooldown } from "../../src/config.js"

const CONFIG: FallbackCooldown = { failureThreshold: 3, cooldownMs: 1000, windowMs: 5000 }

function setup() {
  let at = 10_000
  const breaker = createBreaker(() => at)
  const open = (model = "a/x") => {
    for (let i = 0; i < 3; i++) breaker.failure(model, CONFIG)
  }
  return { breaker, open, advance: (ms: number) => void (at += ms), now: () => at }
}

describe("the defaults", () => {
  test("three failures, a 60 s cooldown and a 60 s window", () => {
    expect(DEFAULT_FALLBACK_COOLDOWN).toEqual({ failureThreshold: 3, cooldownMs: 60_000, windowMs: 60_000 })
  })
})

describe("the breaker of one target", () => {
  test("failures below the threshold do not open it", () => {
    const { breaker } = setup()
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
    expect(breaker.claim("a/x", CONFIG)).toEqual({ verdict: "allow" })
    expect(breaker.cooling()).toEqual([])
  })

  test("the threshold-th failure in a row opens it: the target is skipped until the cooldown ends", () => {
    const { breaker, advance, now } = setup()
    breaker.failure("a/x", CONFIG)
    breaker.failure("a/x", CONFIG)
    expect(breaker.failure("a/x", CONFIG)).toBe("opened")
    expect(breaker.until("a/x")).toBe(now() + 1000)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("skip")
    expect(breaker.peek("a/x", CONFIG)).toBe(false)
    advance(999)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("skip")
    expect(breaker.cooling()).toEqual([{ model: "a/x", state: "open", failures: 3, until: now() + 1 }])
  })

  test("an answer in between ends the streak, so the failures must be consecutive", () => {
    const { breaker } = setup()
    breaker.failure("a/x", CONFIG)
    breaker.failure("a/x", CONFIG)
    expect(breaker.success("a/x")).toBeUndefined()
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
    expect(breaker.failure("a/x", CONFIG)).toBe("opened")
  })

  test("failures further apart than the window start the count over", () => {
    const { breaker, advance } = setup()
    breaker.failure("a/x", CONFIG)
    breaker.failure("a/x", CONFIG)
    advance(5001)
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
    expect(breaker.failure("a/x", CONFIG)).toBe("opened")
  })

  test("the window runs from the first failure of the streak, not from the last", () => {
    const { breaker, advance } = setup()
    breaker.failure("a/x", CONFIG)
    advance(3000)
    breaker.failure("a/x", CONFIG)
    advance(2001)
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
  })

  test("a target that is not open is never held back, and an answer from a closed one reports nothing", () => {
    const { breaker } = setup()
    expect(breaker.claim("a/x", CONFIG)).toEqual({ verdict: "allow" })
    expect(breaker.success("a/x")).toBeUndefined()
    expect(breaker.until("a/x")).toBeUndefined()
  })

  test("each target has its own breaker, and a variant is a target of its own", () => {
    const { breaker, open } = setup()
    open()
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("skip")
    expect(breaker.claim("b/y", CONFIG).verdict).toBe("allow")
    expect(breaker.claim("a/x#low", CONFIG).verdict).toBe("allow")
  })

  test("a threshold of 1 opens on the first failure", () => {
    const { breaker } = setup()
    expect(breaker.failure("a/x", { ...CONFIG, failureThreshold: 1 })).toBe("opened")
  })
})

describe("the half-open probe", () => {
  test("after the cooldown one probe is let through, with a token, and the others still skip", () => {
    const { breaker, open, advance } = setup()
    open()
    advance(1000)
    expect(breaker.peek("a/x", CONFIG)).toBe(true)
    expect(breaker.cooling()[0]).toMatchObject({ state: "half-open" })
    const probe = breaker.claim("a/x", CONFIG)
    expect(probe.verdict).toBe("probe")
    expect(probe.token).toEqual(expect.any(Number))
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("skip")
    expect(breaker.peek("a/x", CONFIG)).toBe(false)
  })

  test("a probe that answers closes the breaker", () => {
    const { breaker, open, advance } = setup()
    open()
    advance(1000)
    breaker.claim("a/x", CONFIG)
    expect(breaker.success("a/x")).toBe("closed")
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("allow")
    expect(breaker.cooling()).toEqual([])
    // And the count starts from zero again.
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
  })

  test("a probe that fails opens it again for a full cooldown", () => {
    const { breaker, open, advance, now } = setup()
    open()
    advance(1000)
    breaker.claim("a/x", CONFIG)
    expect(breaker.failure("a/x", CONFIG)).toBe("reopened")
    expect(breaker.until("a/x")).toBe(now() + 1000)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("skip")
    advance(1000)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("probe")
  })

  test("a probe that ends with no verdict gives its slot back", () => {
    const { breaker, open, advance } = setup()
    open()
    advance(1000)
    const { token } = breaker.claim("a/x", CONFIG)
    breaker.release("a/x", token)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("probe")
  })

  test("only the holder of the probe gives the slot back: another attempt's release does not free it", () => {
    const { breaker, open, advance } = setup()
    open()
    advance(1000)
    const { token } = breaker.claim("a/x", CONFIG)
    breaker.release("a/x")
    breaker.release("a/x", token! + 1)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("skip")
    breaker.release("a/x", token)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("probe")
  })

  test("a failure of an attempt forced through a half-open breaker reopens it, and the old probe's holder cannot free the next probe", () => {
    const { breaker, open, advance } = setup()
    open()
    advance(1000)
    const old = breaker.claim("a/x", CONFIG)
    expect(breaker.failure("a/x", CONFIG)).toBe("reopened")
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("skip")
    advance(1000)
    const next = breaker.claim("a/x", CONFIG)
    expect(next.verdict).toBe("probe")
    breaker.release("a/x", old.token)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("skip")
    breaker.release("a/x", next.token)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("probe")
  })

  test("a probe that never reports does not block the target for good: it is handed out again after a cooldown", () => {
    const { breaker, open, advance } = setup()
    open()
    advance(1000)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("probe")
    advance(999)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("skip")
    advance(1)
    expect(breaker.claim("a/x", CONFIG).verdict).toBe("probe")
  })
})

describe("failures that land on a breaker that is already open", () => {
  test("they count quietly: no reopen, and the cooldown is not extended", () => {
    const { breaker, open, advance, now } = setup()
    open()
    const until = now() + 1000
    advance(400)
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
    expect(breaker.until("a/x")).toBe(until)
    expect(breaker.cooling()[0]).toMatchObject({ failures: 5, until })
  })

  test("the probe's own failure, landing after an attempt forced through reopened the breaker, counts quietly", () => {
    const { breaker, open, advance } = setup()
    open()
    advance(1000)
    breaker.claim("a/x", CONFIG)
    expect(breaker.failure("a/x", CONFIG)).toBe("reopened")
    const until = breaker.until("a/x")
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
    expect(breaker.until("a/x")).toBe(until)
  })

  test("a failure on a half-open breaker reopens it for a full cooldown", () => {
    const { breaker, open, advance, now } = setup()
    open()
    advance(1500)
    expect(breaker.failure("a/x", CONFIG)).toBe("reopened")
    expect(breaker.until("a/x")).toBe(now() + 1000)
  })
})

describe("a breaker nobody uses is forgotten", () => {
  test("after the cooldown plus the cooldown and window again, status and the verdict forget it", () => {
    const { breaker, open, advance } = setup()
    open()
    advance(1000 + 1000 + 5000 - 1)
    expect(breaker.cooling()).toHaveLength(1)
    advance(1)
    expect(breaker.cooling()).toEqual([])
    expect(breaker.claim("a/x", CONFIG)).toEqual({ verdict: "allow" })
    expect(breaker.until("a/x")).toBeUndefined()
    // It starts over: three more failures are needed.
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
  })

  test("a breaker with a probe out is not forgotten while the probe runs", () => {
    const { breaker, open, advance } = setup()
    open()
    advance(1000)
    breaker.claim("a/x", CONFIG)
    advance(60_000)
    expect(breaker.cooling()).toHaveLength(1)
    expect(breaker.success("a/x")).toBe("closed")
  })
})
