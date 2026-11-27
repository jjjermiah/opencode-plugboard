/**
 * `examples/_tools/sessions.py` deletes only sessions whose ownership it can prove, and the rules live in
 * `examples/_tools/test_sessions.py` (a mocked OpenCode API: a leaf foreign child, a fork, a parent, an anchor and a
 * top-level request must all survive). This runs that file so `bun test` covers the tool.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const python = Bun.which("python3")
const script = join(import.meta.dir, "../../examples/_tools/test_sessions.py")

describe("examples/_tools/sessions.py", () => {
  test.skipIf(python === null)("#200 review: the ownership rules hold against a mocked API", () => {
    const run = Bun.spawnSync([python!, script], { stdout: "pipe", stderr: "pipe" })
    const output = `${run.stdout.toString()}\n${run.stderr.toString()}`
    expect(run.exitCode).toBe(0)
    expect(output).toContain("Ran 6 tests")
    expect(output).toContain("OK")
  })
})
