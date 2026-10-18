/**
 * The review gate script (.github/scripts/review-gate.ts, review-gate.yml): the model's verdict is parsed strictly, and a
 * review is posted only for a green, current, same-repository, small pull request. Every other path posts nothing or a COMMENT.
 */
import { describe, expect, test } from "bun:test"
import {
  anthropicLlm,
  evaluateChecks,
  githubApi,
  MARKER,
  parseVerdict,
  reviewGate,
  type CheckRun,
  type DiffResult,
  type GithubApi,
  type Llm,
  type PullInfo,
  type ReviewInfo,
  type ReviewPost,
  type RunEvent,
} from "../../.github/scripts/review-gate.ts"

const REPO = "jjjermiah/opencode-plugboard"
const SHA = "a".repeat(40)
const REQUIRED = ["CI passed", "Lint commit messages", "Analyze (javascript-typescript)"]
const green: CheckRun[] = REQUIRED.map((name) => ({ name, status: "completed", conclusion: "success" }))

const event = (over: Partial<NonNullable<RunEvent["workflow_run"]>> = {}): RunEvent => ({
  workflow_run: { id: 1, event: "pull_request", conclusion: "success", head_sha: SHA, head_repository: { full_name: REPO }, pull_requests: [{ number: 7 }], ...over },
})

interface Fake {
  readonly api: GithubApi
  readonly posted: ReviewPost[]
  readonly calls: string[]
}
const fake = (
  over: {
    pull?: Partial<PullInfo>
    afterPull?: Partial<PullInfo>
    checks?: CheckRun[]
    required?: string[]
    reviews?: ReviewInfo[]
    diff?: DiffResult
    forCommit?: number[]
  } = {},
): Fake => {
  const posted: ReviewPost[] = []
  const calls: string[] = []
  let pullReads = 0
  const base: PullInfo = { number: 7, state: "open", draft: false, title: "feat: x", body: "body", headSha: SHA, headRepo: REPO, baseRef: "main" }
  const api: GithubApi = {
    async pull() {
      calls.push("pull")
      return { ...base, ...over.pull, ...(pullReads++ > 0 ? over.afterPull : {}) }
    },
    async pullsForCommit() {
      calls.push("pullsForCommit")
      return over.forCommit ?? []
    },
    async diff() {
      calls.push("diff")
      return over.diff ?? { kind: "ok", text: "diff --git a/x b/x\n+1" }
    },
    async checkRuns() {
      calls.push("checkRuns")
      return over.checks ?? green
    },
    async requiredChecks() {
      return over.required ?? REQUIRED
    },
    async reviews() {
      return over.reviews ?? []
    },
    async file() {
      return "# AGENTS.md\nrules"
    },
    async postReview(_number, review) {
      posted.push(review)
    },
  }
  return { api, posted, calls }
}
const answer = (text: string): Llm => async () => text
const APPROVE = JSON.stringify({ verdict: "approve", blockers: [], notes: ["rename later"] })
const run = (f: Fake, llm: Llm, extra: Partial<Parameters<typeof reviewGate>[0]> = {}, ev: RunEvent = event()) =>
  reviewGate({ api: f.api, llm, repo: REPO, event: ev, ...extra })

describe("review gate: parsing the model's verdict", () => {
  test("a plain JSON answer, a fenced one, and one wrapped in prose all parse", () => {
    for (const text of [APPROVE, "```json\n" + APPROVE + "\n```", "Here is my verdict:\n" + APPROVE + "\nDone."]) {
      const parsed = parseVerdict(text)
      expect(parsed).toEqual({ ok: true, verdict: { verdict: "approve", blockers: [], notes: ["rename later"] } })
    }
  })

  test("blockers keep their file and line; a string blocker becomes a reason", () => {
    const parsed = parseVerdict(JSON.stringify({ verdict: "request_changes", blockers: [{ file: "src/a.ts", line: 3, why: "crash" }, "leaks a key"] }))
    expect(parsed).toEqual({ ok: true, verdict: { verdict: "request_changes", blockers: [{ why: "crash", file: "src/a.ts", line: 3 }, { why: "leaks a key" }], notes: [] } })
  })

  test("an approve that lists a blocker is a request for changes", () => {
    const parsed = parseVerdict(JSON.stringify({ verdict: "approve", blockers: [{ why: "bug" }], notes: [] }))
    expect(parsed.ok && parsed.verdict.verdict).toBe("request_changes")
  })

  test("garbage, an unknown verdict, a blocker with no reason and request_changes with no blocker do not parse", () => {
    expect(parseVerdict("looks good to me").ok).toBe(false)
    expect(parseVerdict('{"verdict":"maybe"}').ok).toBe(false)
    expect(parseVerdict('{"verdict":"request_changes","blockers":[{"file":"a"}]}').ok).toBe(false)
    expect(parseVerdict('{"verdict":"request_changes","blockers":[]}').ok).toBe(false)
    expect(parseVerdict("[1,2]").ok).toBe(false)
    expect(parseVerdict('{"verdict":"approve","blockers":"none"}').ok).toBe(false)
  })
})

describe("review gate: the checks must be green", () => {
  test("a missing, pending or failed required check is not green; an advisory failure is", () => {
    expect(evaluateChecks(REQUIRED, green)).toEqual({ green: true })
    expect(evaluateChecks(REQUIRED, green.slice(1)).green).toBe(false)
    expect(evaluateChecks(REQUIRED, [{ name: "CI passed", status: "in_progress", conclusion: null }, ...green.slice(1)]).green).toBe(false)
    expect(evaluateChecks(REQUIRED, [{ name: "CI passed", status: "completed", conclusion: "failure" }, ...green.slice(1)]).green).toBe(false)
    expect(evaluateChecks(REQUIRED, [...green, { name: "Request-path benchmarks (advisory)", status: "completed", conclusion: "failure" }])).toEqual({ green: true })
    expect(evaluateChecks(REQUIRED, [...green, { name: "Other", status: "completed", conclusion: "failure" }]).green).toBe(false)
  })

  test("no required checks listed means nothing can be verified", () => {
    expect(evaluateChecks([], green).green).toBe(false)
  })
})

describe("review gate: when it acts", () => {
  test("a green, current, same-repository pull request is approved with the notes and the tested commit", async () => {
    const f = fake()
    const outcomes = await run(f, answer(APPROVE))
    expect(outcomes).toEqual([{ pull: 7, outcome: "approved", reason: "no blockers, 1 notes" }])
    expect(f.posted).toHaveLength(1)
    expect(f.posted[0]).toMatchObject({ commit_id: SHA, event: "APPROVE" })
    expect(f.posted[0]?.body).toContain("rename later")
    expect(f.posted[0]?.body).toContain(MARKER)
  })

  test("blockers post REQUEST_CHANGES with each blocker", async () => {
    const f = fake()
    const outcomes = await run(f, answer(JSON.stringify({ verdict: "request_changes", blockers: [{ file: "src/a.ts", line: 3, why: "crash" }], notes: [] })))
    expect(outcomes[0]?.outcome).toBe("changes-requested")
    expect(f.posted[0]).toMatchObject({ commit_id: SHA, event: "REQUEST_CHANGES" })
    expect(f.posted[0]?.body).toContain("`src/a.ts:3`: crash")
  })

  test("a run that did not succeed posts nothing and reads nothing", async () => {
    const f = fake()
    const outcomes = await run(f, answer(APPROVE), {}, event({ conclusion: "failure" }))
    expect(outcomes[0]?.outcome).toBe("skipped")
    expect(f.posted).toEqual([])
    expect(f.calls).toEqual([])
  })

  test("a fork run is skipped before any API call, and a fork head on the pull request is skipped too", async () => {
    const forkRun = fake()
    const first = await run(forkRun, answer(APPROVE), {}, event({ head_repository: { full_name: "someone/opencode-plugboard" } }))
    expect(first[0]?.reason).toContain("fork")
    expect(forkRun.calls).toEqual([])
    expect(forkRun.posted).toEqual([])

    const forkHead = fake({ pull: { headRepo: "someone/opencode-plugboard" } })
    const second = await run(forkHead, answer(APPROVE))
    expect(second[0]?.reason).toContain("fork")
    expect(forkHead.posted).toEqual([])
    expect(forkHead.calls).not.toContain("diff")
  })

  test("a head that moved since the run is left alone", async () => {
    const f = fake({ pull: { headSha: "b".repeat(40) } })
    const outcomes = await run(f, answer(APPROVE))
    expect(outcomes[0]?.reason).toContain("moved")
    expect(f.posted).toEqual([])
    expect(f.calls).not.toContain("diff")
  })

  test("a head that moves while the model is answering posts nothing", async () => {
    const f = fake({ afterPull: { headSha: "c".repeat(40) } })
    const outcomes = await run(f, answer(APPROVE))
    expect(outcomes[0]?.reason).toContain("during the review")
    expect(f.posted).toEqual([])
  })

  test("a required check that is not green means no review and no model call", async () => {
    let called = false
    const f = fake({ checks: green.slice(1) })
    const outcomes = await run(f, async () => ((called = true), APPROVE))
    expect(outcomes[0]?.outcome).toBe("skipped")
    expect(called).toBe(false)
    expect(f.posted).toEqual([])
  })

  test("a check that turns red while the model answers blocks the approval", async () => {
    let reads = 0
    const f = fake()
    const flaky: GithubApi = { ...f.api, checkRuns: async () => (reads++ === 0 ? green : [{ name: "CI passed", status: "completed", conclusion: "failure" }, ...green.slice(1)]) }
    const outcomes = await reviewGate({ api: flaky, llm: answer(APPROVE), repo: REPO, event: event() })
    expect(outcomes[0]?.outcome).toBe("skipped")
    expect(f.posted).toEqual([])
  })

  test("a draft, a closed pull request, and a run with no pull request are skipped", async () => {
    expect((await run(fake({ pull: { draft: true } }), answer(APPROVE)))[0]?.reason).toContain("draft")
    expect((await run(fake({ pull: { state: "closed" } }), answer(APPROVE)))[0]?.reason).toContain("closed")
    expect((await run(fake(), answer(APPROVE), {}, event({ event: "push", pull_requests: [] })))[0]?.reason).toContain("no open pull request")
  })

  test("a dispatched run with no listed pull request finds it by commit", async () => {
    const f = fake({ forCommit: [7] })
    const outcomes = await run(f, answer(APPROVE), {}, event({ event: "workflow_dispatch", pull_requests: [] }))
    expect(outcomes[0]?.outcome).toBe("approved")
    expect(f.calls).toContain("pullsForCommit")
  })

  test("a commit that already has a verdict from the gate is not reviewed twice", async () => {
    const prior: ReviewInfo = { state: "APPROVED", commitId: SHA, body: `ok\n${MARKER}`, bot: true }
    const f = fake({ reviews: [prior] })
    const outcomes = await run(f, answer(APPROVE))
    expect(outcomes[0]?.outcome).toBe("skipped")
    expect(f.posted).toEqual([])
    // A person's approval, or the gate's review of an older commit, does not count.
    const other = fake({ reviews: [{ ...prior, bot: false }, { ...prior, commitId: "d".repeat(40) }] })
    expect((await run(other, answer(APPROVE)))[0]?.outcome).toBe("approved")
  })
})

describe("review gate: oversize and failed model calls never approve", () => {
  test("a diff over the cap gets one COMMENT and no model call", async () => {
    let called = false
    const f = fake({ diff: { kind: "ok", text: "x".repeat(2_001) } })
    const outcomes = await run(f, async () => ((called = true), APPROVE), { maxDiffBytes: 2_000 })
    expect(outcomes[0]?.outcome).toBe("commented")
    expect(called).toBe(false)
    expect(f.posted).toHaveLength(1)
    expect(f.posted[0]).toMatchObject({ commit_id: SHA, event: "COMMENT" })
    expect(f.posted[0]?.body).toContain("too large")
    // The same commit is not told twice.
    const again = fake({ diff: { kind: "too-large" }, reviews: [{ state: "COMMENTED", commitId: SHA, body: f.posted[0]?.body ?? "", bot: true }] })
    expect((await run(again, answer(APPROVE)))[0]?.outcome).toBe("skipped")
    expect(again.posted).toEqual([])
  })

  test("a diff GitHub refuses to render counts as too large", async () => {
    const f = fake({ diff: { kind: "too-large" } })
    expect((await run(f, answer(APPROVE)))[0]?.outcome).toBe("commented")
    expect(f.posted[0]?.event).toBe("COMMENT")
  })

  test("a failed model call posts a COMMENT that says so, and no approval", async () => {
    const f = fake()
    const outcomes = await run(f, async () => {
      throw new Error("Anthropic Messages returned HTTP 529")
    })
    expect(outcomes[0]?.outcome).toBe("commented")
    expect(f.posted).toHaveLength(1)
    expect(f.posted[0]?.event).toBe("COMMENT")
    expect(f.posted[0]?.body).toContain("HTTP 529")
  })

  test("an answer that does not parse posts a COMMENT, and the commit can be retried", async () => {
    const f = fake()
    const outcomes = await run(f, answer("I think it is fine."))
    expect(outcomes[0]?.outcome).toBe("commented")
    expect(f.posted[0]?.event).toBe("COMMENT")
    expect(f.posted[0]?.body).toContain("could not read")
    const retry = fake({ reviews: [{ state: "COMMENTED", commitId: SHA, body: f.posted[0]?.body ?? "", bot: true }] })
    expect((await run(retry, answer(APPROVE)))[0]?.outcome).toBe("approved")
  })
})

describe("review gate: the HTTP adapters", () => {
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
  const rejection = (promise: Promise<unknown>): Promise<Error> =>
    promise.then(
      () => {
        throw new Error("expected the call to reject")
      },
      (error: unknown) => error as Error,
    )

  test("the Anthropic call sends the key and model, joins text blocks and skips thinking blocks", async () => {
    let seen: { url: string; headers: Record<string, string>; body: { model: string; system: string; messages: unknown[] } } | undefined
    const llm = anthropicLlm({
      key: "sk-test",
      model: "claude-sonnet-5-5",
      fetch: async (url, init) => {
        seen = { url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) }
        return json({ content: [{ type: "thinking", thinking: "..." }, { type: "text", text: APPROVE }] })
      },
      sleep: async () => {},
    })
    expect(await llm("sys", "user")).toBe(APPROVE)
    expect(seen?.url).toBe("https://api.anthropic.com/v1/messages")
    expect(seen?.headers["x-api-key"]).toBe("sk-test")
    expect(seen?.body.model).toBe("claude-sonnet-5-5")
    expect(seen?.body.messages).toEqual([{ role: "user", content: "user" }])
  })

  test("a 529 is retried once; a persistent failure throws without the key or the body", async () => {
    let calls = 0
    const llm = anthropicLlm({
      key: "sk-secret",
      model: "m",
      fetch: async () => (calls++ === 0 ? json({ error: "overloaded sk-secret" }, 529) : json({ content: [{ type: "text", text: "ok" }] })),
      sleep: async () => {},
    })
    expect(await llm("s", "u")).toBe("ok")
    expect(calls).toBe(2)

    const failing = anthropicLlm({ key: "sk-secret", model: "m", fetch: async () => json({ error: "no sk-secret" }, 401), sleep: async () => {} })
    const error = await rejection(failing("s", "u"))
    expect(error.message).toBe("Anthropic Messages returned HTTP 401")
    expect(error.message).not.toContain("sk-secret")

    const empty = anthropicLlm({ key: "k", model: "m", fetch: async () => json({ content: [], stop_reason: "max_tokens" }), sleep: async () => {} })
    expect((await rejection(empty("s", "u"))).message).toContain("max_tokens")
  })

  test("the GitHub diff call asks for the diff media type and maps 406 to too-large", async () => {
    const accepts: string[] = []
    const api = githubApi("tok", REPO, async (_url, init) => {
      accepts.push((init?.headers as Record<string, string> | undefined)?.Accept ?? "")
      return accepts.length === 1 ? new Response("diff --git", { status: 200 }) : new Response("too big", { status: 406 })
    })
    expect(await api.diff(7)).toEqual({ kind: "ok", text: "diff --git" })
    expect(await api.diff(7)).toEqual({ kind: "too-large" })
    expect(accepts).toEqual(["application/vnd.github.diff", "application/vnd.github.diff"])
  })

  test("the review is posted with commit_id, event and body, and a rejected post throws", async () => {
    const sent: { url: string; body: unknown }[] = []
    const api = githubApi("tok", REPO, async (url, init) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) })
      return json({}, sent.length === 1 ? 200 : 422)
    })
    const review: ReviewPost = { commit_id: SHA, event: "APPROVE", body: "ok" }
    await api.postReview(7, review)
    expect(sent[0]).toEqual({ url: `https://api.github.com/repos/${REPO}/pulls/7/reviews`, body: review })
    await expect(api.postReview(7, review)).rejects.toThrow("returned 422")
  })

  test("required checks come from the branch rules and reviews are read as bot or not", async () => {
    const api = githubApi("tok", REPO, async (url) =>
      url.includes("/rules/branches/")
        ? json([{ type: "deletion" }, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI passed" }] } }])
        : json([
            { state: "APPROVED", commit_id: SHA, body: "x", user: { type: "Bot" } },
            { state: "APPROVED", commit_id: SHA, body: null, user: { type: "User" } },
          ]),
    )
    expect(await api.requiredChecks("main")).toEqual(["CI passed"])
    expect((await api.reviews(7)).map((r) => r.bot)).toEqual([true, false])
  })
})
