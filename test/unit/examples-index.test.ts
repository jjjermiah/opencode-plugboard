/**
 * The examples index (.github/scripts/examples-index.ts) and the run reader it shares with the docs
 * (docs/.vitepress/examples-model.ts). The CI check runs the script on the real tree; these tests show what it reports
 * on the cases it must catch: a stale or missing table row, a missing Shows text, a snippet import that names a missing file
 * or region, and a live run chosen by date and then plugboard version.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderTable, snippetProblems } from "../../.github/scripts/examples-index.ts"
import { readExamples, verdictCell, type ExampleEntry } from "../../docs/.vitepress/examples-model.ts"

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "examples-index-"))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, text)
}

/** A run directory with a summary.json; `verdict` and `version` are the only fields the table and the sort read. */
const summary = (verdict: string, version: string, date = "2026-10-13") =>
  JSON.stringify({ schema: 1, date, verdict, client: { name: "x", version: "1", runtime: { name: "node", version: "1" } }, plugboard: { version, commit: "abc1234" }, scenarios: [] })

describe("the generated table", () => {
  const entries: ExampleEntry[] = [
    {
      name: "alpha",
      scripted: { kind: "scripted", path: "runs/scripted", date: null, commit: null, verdict: "pass", client: null, plugboard: null, scenarios: [] },
      newestLive: { kind: "historical", path: "runs/live/2026-10-11-f351307", date: "2026-10-11", commit: "f351307", verdict: null, client: null, plugboard: null, scenarios: [] },
    },
    { name: "beta", scripted: null, newestLive: null },
  ]

  test("one row per example, with the scripted verdict and the newest live run", () => {
    const table = renderTable(entries, { alpha: "Alpha shows things", beta: "Beta" })
    expect(table).toContain("| [alpha/](alpha/) | Alpha shows things | pass | [`2026-10-11-f351307`](alpha/runs/live/2026-10-11-f351307/), historical record |")
    expect(table).toContain("| [beta/](beta/) | Beta | not run | not run |")
  })

  test("an example with no Shows text is named in its own row, so the check fails on it", () => {
    expect(renderTable(entries, {})).toContain("(no Shows text in examples/_harness/index.json)")
  })

  test("a verdict cell is a word, `not run`, or the historical marker", () => {
    expect(verdictCell(null)).toBe("not run")
    expect(verdictCell({ ...entries[0]!.newestLive!, verdict: "partial" })).toBe("partial")
    expect(verdictCell(entries[0]!.newestLive)).toBe("historical record")
  })
})

describe("snippet imports", () => {
  let docs = ""
  let examples = ""
  beforeAll(() => {
    docs = join(root, "docs")
    examples = join(root, "examples")
    write(join(examples, "x/chat.py"), "# region snippet\nprint(1)\n# endregion snippet\n# region snippet-tool\nx\n# endregion snippet-tool\n")
    write(join(examples, "x/ts.ts"), "// #region snippet-raw\nconst a = 1\n// #endregion snippet-raw\n")
  })

  test("an import of an existing file and region resolves", () => {
    write(join(docs, "ok.md"), "<<< @/../examples/x/chat.py#snippet\n<<< @/../examples/x/ts.ts#snippet-raw\n")
    expect(snippetProblems(docs, examples).filter((problem) => problem.includes("ok.md"))).toEqual([])
  })

  test("a renamed region is reported by name", () => {
    write(join(docs, "renamed.md"), "<<< @/../examples/x/chat.py#snippet-s1\n")
    const problems = snippetProblems(docs, examples).filter((problem) => problem.includes("renamed.md"))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('<<< x/chat.py#snippet-s1: no region "snippet-s1" in that file')
  })

  test("an import of a missing file is reported", () => {
    write(join(docs, "missing.md"), "<<< @/../examples/x/gone.py#snippet\n")
    const problems = snippetProblems(docs, examples).filter((problem) => problem.includes("missing.md"))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("the file does not exist")
  })
})

describe("readExamples", () => {
  let dir = ""
  beforeAll(() => {
    dir = join(root, "reader")
    // Two live runs on the same day at different plugboard versions: 0.9.0 sorts before 0.10.0 (numeric, not text).
    write(join(dir, "tool/runs/live/2026-10-13-aaa1111/summary.json"), summary("partial", "0.9.0"))
    write(join(dir, "tool/runs/live/2026-10-13-bbb2222/summary.json"), summary("pass", "0.10.0"))
    // A historical record with only a REPORT.md, from an earlier day.
    write(join(dir, "tool/runs/live/2026-10-11-ccc3333/REPORT.md"), "# old\n")
    write(join(dir, "tool/runs/scripted/summary.json"), summary("pass", "0.1.0", "2026-10-13"))
    // A directory without runs at all.
    mkdirSync(join(dir, "bare"), { recursive: true })
    // Underscore directories are harness parts, not examples.
    mkdirSync(join(dir, "_shared"), { recursive: true })
  })

  test("lists example directories only, sorted by name", () => {
    expect(readExamples(dir).map((entry) => entry.name)).toEqual(["bare", "tool"])
  })

  test("the newest live run is the later date, then the higher plugboard version", () => {
    const tool = readExamples(dir).find((entry) => entry.name === "tool")!
    expect(tool.newestLive?.path).toBe("runs/live/2026-10-13-bbb2222")
    expect(tool.newestLive?.verdict).toBe("pass")
  })

  test("the scripted run is read from runs/scripted", () => {
    expect(readExamples(dir).find((entry) => entry.name === "tool")!.scripted?.verdict).toBe("pass")
  })

  test("an example with no runs has no scripted and no live entry", () => {
    const bare = readExamples(dir).find((entry) => entry.name === "bare")!
    expect(bare.scripted).toBeNull()
    expect(bare.newestLive).toBeNull()
  })
})
