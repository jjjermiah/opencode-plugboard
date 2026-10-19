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
  return { breaker, advance: (ms: number) => void (at += ms), now: () => at }
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
    expect(breaker.claim("a/x", CONFIG)).toBe("allow")
    expect(breaker.cooling()).toEqual([])
  })

  test("the threshold-th failure in a row opens it: the target is skipped until the cooldown ends", () => {
    const { breaker, advance, now } = setup()
    breaker.failure("a/x", CONFIG)
    breaker.failure("a/x", CONFIG)
    expect(breaker.failure("a/x", CONFIG)).toBe("opened")
    expect(breaker.until("a/x")).toBe(now() + 1000)
    expect(breaker.claim("a/x", CONFIG)).toBe("skip")
    expect(breaker.peek("a/x", CONFIG)).toBe(false)
    advance(999)
    expect(breaker.claim("a/x", CONFIG)).toBe("skip")
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

  test("after the cooldown one probe is let through, and the others still skip", () => {
    const { breaker, advance } = setup()
    for (let i = 0; i < 3; i++) breaker.failure("a/x", CONFIG)
    advance(1000)
    expect(breaker.peek("a/x", CONFIG)).toBe(true)
    expect(breaker.cooling()[0]).toMatchObject({ state: "half-open" })
    expect(breaker.claim("a/x", CONFIG)).toBe("probe")
    expect(breaker.claim("a/x", CONFIG)).toBe("skip")
    expect(breaker.peek("a/x", CONFIG)).toBe(false)
  })

  test("a probe that answers closes the breaker", () => {
    const { breaker, advance } = setup()
    for (let i = 0; i < 3; i++) breaker.failure("a/x", CONFIG)
    advance(1000)
    breaker.claim("a/x", CONFIG)
    expect(breaker.success("a/x")).toBe("closed")
    expect(breaker.claim("a/x", CONFIG)).toBe("allow")
    expect(breaker.cooling()).toEqual([])
    // And the count starts from zero again.
    expect(breaker.failure("a/x", CONFIG)).toBeUndefined()
  })

  test("a probe that fails opens it again for a full cooldown", () => {
    const { breaker, advance, now } = setup()
    for (let i = 0; i < 3; i++) breaker.failure("a/x", CONFIG)
    advance(1000)
    breaker.claim("a/x", CONFIG)
    expect(breaker.failure("a/x", CONFIG)).toBe("reopened")
    expect(breaker.until("a/x")).toBe(now() + 1000)
    expect(breaker.claim("a/x", CONFIG)).toBe("skip")
    advance(1000)
    expect(breaker.claim("a/x", CONFIG)).toBe("probe")
  })

  test("a probe that ends with no verdict gives its slot back", () => {
    const { breaker, advance } = setup()
    for (let i = 0; i < 3; i++) breaker.failure("a/x", CONFIG)
    advance(1000)
    expect(breaker.claim("a/x", CONFIG)).toBe("probe")
    breaker.release("a/x")
    expect(breaker.claim("a/x", CONFIG)).toBe("probe")
  })

  test("a probe that never reports does not block the target for good: it is handed out again after a cooldown", () => {
    const { breaker, advance } = setup()
    for (let i = 0; i < 3; i++) breaker.failure("a/x", CONFIG)
    advance(1000)
    expect(breaker.claim("a/x", CONFIG)).toBe("probe")
    advance(999)
    expect(breaker.claim("a/x", CONFIG)).toBe("skip")
    advance(1)
    expect(breaker.claim("a/x", CONFIG)).toBe("probe")
  })

  test("a target that is not open is never held back, and an answer from a closed one reports nothing", () => {
    const { breaker } = setup()
    expect(breaker.claim("a/x", CONFIG)).toBe("allow")
    expect(breaker.success("a/x")).toBeUndefined()
    expect(breaker.until("a/x")).toBeUndefined()
  })

  test("each target has its own breaker", () => {
    const { breaker } = setup()
    for (let i = 0; i < 3; i++) breaker.failure("a/x", CONFIG)
    expect(breaker.claim("a/x", CONFIG)).toBe("skip")
    expect(breaker.claim("b/y", CONFIG)).toBe("allow")
    expect(breaker.claim("a/x#low", CONFIG)).toBe("allow")
  })

  test("a threshold of 1 opens on the first failure", () => {
    const { breaker } = setup()
    expect(breaker.failure("a/x", { ...CONFIG, failureThreshold: 1 })).toBe("opened")
  })
})
