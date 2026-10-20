/**
 * The examples harness normaliser and writer (examples/_harness/normalise.ts, render.ts). Each test names the rule
 * it protects; the rules are the Contract's "Normalising and redaction" section in issue #174.
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Exchange } from "../../examples/_harness/capture.ts"
import { canonicalJson, normaliseSessionContext, normaliseSessionContextValue, normaliseTranscript, parseFrames, redactPath } from "../../examples/_harness/normalise.ts"
import { verdictOf, writeRun, type RunSummary, type ScenarioRow } from "../../examples/_harness/render.ts"

const exchange = (overrides: Partial<Exchange>): Exchange => ({
  seq: 0,
  mark: 0,
  method: "POST",
  path: "/v1/chat/completions",
  reqHeaders: { "content-type": "application/json", authorization: "Bearer sk-secret-app-key" },
  reqBody: "{}",
  status: 200,
  resHeaders: { "content-type": "application/json", "x-plugboard-request-id": "req_abc123", "x-plugboard-app": "compat", date: "Mon, 12 Oct 2026 00:00:00 GMT" },
  resBody: "{}",
  durationMs: 1,
  ...overrides,
})

describe("placeholders for ids", () => {
  test("a turn-1 call id equals turn-2's tool_call_id within one file", () => {
    const turn1 = exchange({
      seq: 0,
      resBody: JSON.stringify({ id: "chatcmpl-AAA111", choices: [{ message: { tool_calls: [{ id: "call_9f8e7d", type: "function" }] } }] }),
    })
    const turn2 = exchange({
      seq: 1,
      reqBody: JSON.stringify({ messages: [{ role: "tool", tool_call_id: "call_9f8e7d", content: "{}" }] }),
    })
    const { exchanges } = normaliseTranscript([turn1, turn2])
    const callId = (exchanges[0]!.response.body as { choices: Array<{ message: { tool_calls: Array<{ id: string }> } }> }).choices[0]!.message.tool_calls[0]!.id
    const toolCallId = (exchanges[1]!.request.body as { messages: Array<{ tool_call_id: string }> }).messages[0]!.tool_call_id
    // Numbering follows sorted keys, so `choices` (and its call id) is seen before the top-level `id`.
    expect(callId).toMatch(/^<id-\d+>$/)
    expect(toolCallId).toBe(callId)
  })

  test("placeholders are numbered by first appearance in each file, so two files start at <id-1>", () => {
    const first = normaliseTranscript([exchange({ resBody: JSON.stringify({ id: "msg_one" }) })])
    const second = normaliseTranscript([exchange({ resBody: JSON.stringify({ id: "msg_two" }) })])
    expect((first.exchanges[0]!.response.body as { id: string }).id).toBe("<id-1>")
    expect((second.exchanges[0]!.response.body as { id: string }).id).toBe("<id-1>")
  })

  test("Gemini's unprefixed responseId is replaced under its key, so two runs match", () => {
    const { exchanges } = normaliseTranscript([exchange({ resBody: JSON.stringify({ candidates: [], responseId: "cc8873367ce847bb8995d5" }) })])
    expect(exchanges[0]!.response.body).toEqual({ candidates: [], responseId: "<id-1>" })
  })

  test("two equal timestamps in one file are two placeholders, so a second boundary does not change the file", () => {
    const same = JSON.stringify({ created: 1791749771 })
    const { exchanges } = normaliseTranscript([exchange({ resBody: same, seq: 0 }), exchange({ resBody: same, seq: 1 })])
    expect(exchanges.map((item) => (item.response.body as { created: string }).created)).toEqual(["<time-1>", "<time-2>"])
  })

  test("a UUID inside a string is replaced by pattern, not only under an id key", () => {
    const { exchanges } = normaliseTranscript([exchange({ resBody: JSON.stringify({ error: "request 1f2e3d4c-0000-4000-8000-123456789abc failed" }) })])
    expect(exchanges[0]!.response.body).toEqual({ error: "request <id-1> failed" })
  })

  test("model ids on a GET of a models route are names and stay as they are", () => {
    const list = exchange({
      method: "GET",
      path: "/v1/models",
      reqBody: "",
      resBody: JSON.stringify({
        object: "list",
        data: [
          { id: "fast", object: "model", created: 0 },
          { id: "anthropic/claude-haiku-4-5", object: "model", created: 0 },
        ],
      }),
    })
    const body = normaliseTranscript([list]).exchanges[0]!.response.body as { data: Array<{ id: string; created: number }> }
    expect(body.data.map((model) => model.id)).toEqual(["fast", "anthropic/claude-haiku-4-5"])
    expect(body.data[0]!.created).toBe(0)
  })
})

describe("URLs, headers and secrets", () => {
  test("the loopback plugboard URL becomes <plugboard>, error text included", () => {
    const { exchanges } = normaliseTranscript([exchange({ resBody: JSON.stringify({ error: { message: "upstream http://127.0.0.1:52231/v1 refused" } }) })])
    expect(exchanges[0]!.response.body).toEqual({ error: { message: "upstream <plugboard>/v1 refused" } })
  })

  test("only allow-listed request headers survive; the bearer key never does", () => {
    const { exchanges } = normaliseTranscript([
      exchange({
        reqHeaders: { authorization: "Bearer sk-secret-app-key", "x-api-key": "sk-secret-app-key", "content-type": "application/json", "user-agent": "OpenAI/Python", "x-stainless-os": "MacOS" },
      }),
    ])
    expect(exchanges[0]!.request.headers).toEqual({ "content-type": "application/json" })
  })

  test("x-plugboard-* response headers are kept except the request id; date is never kept", () => {
    const { exchanges } = normaliseTranscript([exchange({})])
    expect(exchanges[0]!.response.headers).toEqual({ "content-type": "application/json", "x-plugboard-app": "compat" })
  })

  test("the key query parameter is removed and the rest of the target is kept", () => {
    expect(redactPath("/v1beta/models/fast:generateContent?key=sk-secret&alt=sse")).toBe("/v1beta/models/fast:generateContent?alt=sse")
    expect(redactPath("/v1beta/models/fast:generateContent?key=sk-secret")).toBe("/v1beta/models/fast:generateContent")
  })
})

describe("SSE and files", () => {
  test("parsed frames carry data as JSON, keep [DONE], and drop keepalive comments", () => {
    const frames = parseFrames(': keepalive\n\ndata: {"choices":[{"delta":{"content":"pong"}}]}\n\ndata: [DONE]\n\n')
    expect(frames).toEqual([{ data: { choices: [{ delta: { content: "pong" } }] } }, { data: "[DONE]" }])
  })

  test("canonical JSON sorts keys at every depth, indents two spaces and ends with a newline", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe('{\n  "a": {\n    "c": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ],\n    "d": 2\n  },\n  "b": 1\n}\n')
  })
})

describe("Gemini CLI session context", () => {
  const block = [
    "<session_context>",
    "This is the Gemini CLI. We are setting up the context for our chat.",
    "Today's date is Thursday, October 15, 2026 (formatted according to the user's locale).",
    "My operating system is: darwin",
    "The project's temporary directory is: /var/folders/xn/abc/T/plugboard-gemini-cli-home/.gemini/tmp/x",
    "- **Workspace Directories:**",
    "  - /Users/someone/work/plugboard-gemini-cli-workspace",
    "</session_context>",
  ].join("\n")

  test("replaces the date, OS, temp dir and workspace inside the block with fixed placeholders", () => {
    const out = normaliseSessionContext(`Preamble with 2026-10-15 and darwin.\n${block}\nAfter.`)
    expect(out).toBe(
      [
        "Preamble with 2026-10-15 and darwin.",
        "<session_context>",
        "This is the Gemini CLI. We are setting up the context for our chat.",
        "Today's date is <date> (formatted according to the user's locale).",
        "My operating system is: <os>",
        "The project's temporary directory is: <temp-dir>",
        "- **Workspace Directories:**",
        "  - <workspace>",
        "</session_context>",
        "After.",
      ].join("\n"),
    )
  })

  test("two runs on different days and machines give the same text", () => {
    const other = block.replace("Thursday, October 15, 2026", "Friday, October 16, 2026").replace("darwin", "linux").replace("/var/folders/xn/abc/T", "/tmp")
    expect(normaliseSessionContext(other)).toBe(normaliseSessionContext(block))
  })

  test("leaves text outside the block alone, and text without the block unchanged", () => {
    expect(normaliseSessionContext("Today's date is 2026-10-15 and darwin")).toBe("Today's date is 2026-10-15 and darwin")
  })

  test("replaces the CLI's home and workspace paths wherever they appear in the request text", () => {
    const prompt = "Memory at (/var/folders/xn/T/plugboard-gemini-cli-home/.gemini/GEMINI.md) and /tmp/plugboard-gemini-cli-workspace/x"
    expect(normaliseSessionContext(prompt)).toBe("Memory at (<gemini-cli-home>/.gemini/GEMINI.md) and <gemini-cli-workspace>/x")
  })

  test("the pid in the home and workspace names does not reach the text", () => {
    const prompt = "Memory at (/var/folders/xn/T/plugboard-gemini-cli-home-48213/.gemini/GEMINI.md) and /tmp/plugboard-gemini-cli-workspace-7/x"
    expect(normaliseSessionContext(prompt)).toBe(normaliseSessionContext("Memory at (/var/folders/xn/T/plugboard-gemini-cli-home/.gemini/GEMINI.md) and /tmp/plugboard-gemini-cli-workspace/x"))
  })

  test("replaces only the checkout prefix of the CLI's install path, so a local and a CI checkout give the same text", () => {
    const local = "<location>/Users/a/work/opencode-plugboard/examples/gemini-cli/node_modules/@google/gemini-cli/bundle/builtin/skill-creator/SKILL.md</location>"
    const ci = "<location>/home/runner/work/opencode-plugboard/opencode-plugboard/examples/gemini-cli/node_modules/@google/gemini-cli/bundle/builtin/skill-creator/SKILL.md</location>"
    expect(normaliseSessionContext(local)).toBe("<location><checkout>/examples/gemini-cli/node_modules/@google/gemini-cli/bundle/builtin/skill-creator/SKILL.md</location>")
    expect(normaliseSessionContext(ci)).toBe(normaliseSessionContext(local))
  })

  test("fixes Codex CLI's turn start time and sandbox in its turn metadata string, and nothing else in it", () => {
    const metadata = (start: number, sandbox: string) => `{"turn_id":"t","sandbox":"${sandbox}","sandbox_mode":"read-only","turn_started_at_unix_ms":${start},"model":"fast"}`
    expect(normaliseSessionContext(metadata(1792371742059, "seatbelt"))).toBe('{"turn_id":"t","sandbox":"<sandbox>","sandbox_mode":"read-only","turn_started_at_unix_ms":<unix-ms>,"model":"fast"}')
    expect(normaliseSessionContext(metadata(1, "landlock"))).toBe(normaliseSessionContext(metadata(2, "seatbelt")))
  })

  test("fixes the wall time Codex CLI prints in a tool result (the run's own timing), and nothing else in it", () => {
    expect(normaliseSessionContext("Wall time: 0.0003 seconds\nOutput:")).toBe("Wall time: <seconds> seconds\nOutput:")
    expect(normaliseSessionContext("Script completed\nWall time 0.0 seconds\nOutput:\n")).toBe("Script completed\nWall time <seconds> seconds\nOutput:\n")
    expect(normaliseSessionContext("It took 3 seconds")).toBe("It took 3 seconds")
  })

  test("fixes the date PR-Agent puts after its `--PR Info--` header, and no other date", () => {
    const prompt = (date: string) => `\n--PR Info--\n\nToday's Date: ${date}\n\nTitle: 'feature/greeting'\n\nReleased 2026-01-02.`
    expect(normaliseSessionContext(prompt("2026-10-19"))).toBe("\n--PR Info--\n\nToday's Date: <date>\n\nTitle: 'feature/greeting'\n\nReleased 2026-01-02.")
    expect(normaliseSessionContext(prompt("2026-10-19"))).toBe(normaliseSessionContext(prompt("2027-01-01")))
    expect(normaliseSessionContext("Today's Date: 2026-10-19")).toBe("Today's Date: 2026-10-19")
  })

  test("fixes Claude Code's workspace path, home path and project directory name, whatever the temp dir and pid", () => {
    const prompt = (tmp: string, slug: string, pid: number) =>
      `Primary working directory: ${tmp}/plugboard-claude-code-workspace-${pid}\nread the transcript at: ${tmp}/plugboard-claude-code-home-${pid}/.claude/projects/${slug}-plugboard-claude-code-workspace-${pid}/abc.jsonl`
    const mac = prompt("/private/var/folders/xn/09rpd/T", "-private-var-folders-xn-09rpd-T", 84671)
    const ci = prompt("/tmp", "-tmp", 3012)
    expect(normaliseSessionContext(mac)).toBe("Primary working directory: <claude-code-workspace>\nread the transcript at: <claude-code-home>/.claude/projects/<claude-code-project>/abc.jsonl")
    expect(normaliseSessionContext(ci)).toBe(normaliseSessionContext(mac))
  })

  test("fixes the platform, shell and OS version in Claude Code's environment block, and no other line of it", () => {
    const env = (platform: string, shell: string, os: string) =>
      `# Environment\n - Primary working directory: /w\n - Is a git repository: false\n - Platform: ${platform}\n - Shell: ${shell}\n - OS Version: ${os}\n - Next line.`
    expect(normaliseSessionContext(env("darwin", "zsh", "Darwin 27.0.0"))).toBe(env("<platform>", "<shell>", "<os-version>"))
    expect(normaliseSessionContext(env("linux", "bash", "Linux 6.8.0-1015-azure"))).toBe(normaliseSessionContext(env("darwin", "zsh", "Darwin 27.0.0")))
    expect(normaliseSessionContext("Platform: darwin")).toBe("Platform: darwin")
  })

  test("fixes the date Claude Code puts in its system prompt and its system reminder, and no other date", () => {
    const prompt = (date: string) => `You are powered by the model fast.\n\nToday's date is ${date}.\n<system-reminder>\nToday's date is ${date}.\n</system-reminder>\nReleased 2026-01-02.`
    expect(normaliseSessionContext(prompt("2026-10-19"))).toBe(
      "You are powered by the model fast.\n\nToday's date is <date>.\n<system-reminder>\nToday's date is <date>.\n</system-reminder>\nReleased 2026-01-02.",
    )
    expect(normaliseSessionContext(prompt("2026-10-19"))).toBe(normaliseSessionContext(prompt("2027-01-01")))
    expect(normaliseSessionContext("Today's date is 2026-10-19 and more")).toBe("Today's date is 2026-10-19 and more")
  })

  test("fixes the sub-agent id and run time Claude Code puts in an Agent tool result, and nothing else in it", () => {
    const result = (id: string, ms: number) =>
      `The report.\nagentId: ${id} (use SendMessage with to: '${id}', summary: 'x' to continue this agent)\n<usage>subagent_tokens: 18\ntool_uses: 0\nduration_ms: ${ms}</usage>`
    expect(normaliseSessionContext(result("a07a22c557ff2e83b", 27))).toBe(
      "The report.\nagentId: <agent-id> (use SendMessage with to: '<agent-id>', summary: 'x' to continue this agent)\n<usage>subagent_tokens: 18\ntool_uses: 0\nduration_ms: <ms></usage>",
    )
    expect(normaliseSessionContext(result("0123456789abcdef0", 4012))).toBe(normaliseSessionContext(result("a07a22c557ff2e83b", 27)))
  })

  test("the response body is normalised too: a scripted tool call names a path in the CLI's workspace", () => {
    const body = JSON.stringify({ file_path: "/private/var/folders/xn/T/plugboard-claude-code-workspace-9/notes.txt" })
    const sse = `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: body } })}\n\n`
    const { exchanges } = normaliseTranscript([exchange({ resBody: sse, resHeaders: { "content-type": "text/event-stream" } })])
    expect(JSON.stringify(exchanges[0]!.response.body)).toContain("<claude-code-workspace>/notes.txt")
    expect(JSON.stringify(exchanges[0]!.response.body)).not.toContain("plugboard-claude-code-workspace")
  })

  test("fixes the platform, shell and date in Aider's diff-format prompt, and no other line", () => {
    const prompt = (platform: string, shell: string, date: string) =>
      `Keep in mind:\n- Platform: ${platform}\n- Shell: SHELL=${shell}\n- Current date: ${date}\n- The user is operating inside a git repository\n\nReleased 2026-01-02.`
    expect(normaliseSessionContext(prompt("macOS-27.0-arm64-arm-64bit", "/opt/homebrew/bin/zsh", "2026-10-19"))).toBe(
      "Keep in mind:\n- Platform: <platform>\n- Shell: <shell>\n- Current date: <date>\n- The user is operating inside a git repository\n\nReleased 2026-01-02.",
    )
    expect(normaliseSessionContext(prompt("macOS-27.0-arm64-arm-64bit", "/opt/homebrew/bin/zsh", "2026-10-19"))).toBe(
      normaliseSessionContext(prompt("Linux-6.8.0-x86_64-with-glibc2.39", "/bin/bash", "2027-01-01")),
    )
    expect(normaliseSessionContext("Current date: 2026-10-19")).toBe("Current date: 2026-10-19")
  })

  test("puts the Gemini CLI's available skills in name order, whatever order the filesystem listed them", () => {
    const skill = (name: string) => `  <skill>\n    <name>${name}</name>\n    <description>About ${name}.</description>\n  </skill>`
    const prompt = (...names: Array<string>) => `Before.\n<available_skills>\n${names.map(skill).join("\n")}\n</available_skills>\nAfter.`
    expect(normaliseSessionContext(prompt("skill-creator", "antigravity-support"))).toBe(prompt("antigravity-support", "skill-creator"))
    expect(normaliseSessionContext(prompt("b", "c", "a"))).toBe(normaliseSessionContext(prompt("c", "a", "b")))
    expect(normaliseSessionContext(prompt("b", "c", "a"))).toBe(prompt("a", "b", "c"))
    expect(normaliseSessionContext("<skill><name>z</name></skill><skill><name>a</name></skill>")).toBe("<skill><name>z</name></skill><skill><name>a</name></skill>")
  })

  test("applies to every string of a parsed body and keeps its structure", () => {
    const body = { contents: [{ parts: [{ text: block }, { text: "Reply with exactly: pong" }] }], n: 3 }
    const out = normaliseSessionContextValue(body) as typeof body
    expect(out.contents[0]!.parts[0]!.text).toContain("My operating system is: <os>")
    expect(out.contents[0]!.parts[1]!.text).toBe("Reply with exactly: pong")
    expect(out.n).toBe(3)
  })
})

describe("writer", () => {
  const row = (status: ScenarioRow["status"], required = true): ScenarioRow => ({ id: "S1", model: "fast", required, status, checks: [], note: null, error: null, transcript: null })
  const summary = (secretBody: string): RunSummary => ({
    schema: 1,
    example: "unit",
    target: "scripted",
    client: { name: "unit", version: "1.0.0", runtime: { name: "bun", version: "1.4" } },
    models: ["fast"],
    verdict: "pass",
    scenarios: [{ id: "S1", model: "fast", required: true, status: "pass", checks: [], note: null, error: secretBody, transcript: "transcripts/S1.fast.json" }],
  })

  test("a summary whose transcript carries the app key is refused, and nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plugboard-examples-"))
    try {
      const transcripts = { "S1.fast.json": normaliseTranscript([exchange({ resBody: JSON.stringify({ leaked: "sk-secret-app-key" }) })]) }
      await expect(writeRun({ dir, summary: summary("ok"), transcripts, secret: "sk-secret-app-key", replaceTranscripts: false })).rejects.toThrow(/app key appears/)
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a verdict fails on a required failure and is partial on a gap or an optional failure", () => {
    expect(verdictOf([row("fail")])).toBe("fail")
    expect(verdictOf([row("gap")])).toBe("partial")
    expect(verdictOf([row("fail", false)])).toBe("partial")
    expect(verdictOf([row("pass"), row("n/a")])).toBe("pass")
  })
})
