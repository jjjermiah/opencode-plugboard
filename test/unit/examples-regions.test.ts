/**
 * The snippet-region rule (examples/_harness/check-regions.ts, README "Snippet regions"). Each test names the rule it
 * protects. CI runs the script over the tracked examples; these tests show it fails on each kind of violation.
 */
import { describe, expect, test } from "bun:test"
import { regionProblems } from "../../examples/_harness/check-regions.ts"

describe("region names", () => {
  test("snippet and snippet-<kebab-case> pass", () => {
    expect(regionProblems("a.py", "# region snippet\nx\n# endregion snippet\n# region snippet-s1-raw\ny\n# endregion snippet-s1-raw")).toEqual([])
  })

  test("a name outside the form is reported (openai-js wrong-key, parse, Raw, snippet_x)", () => {
    for (const name of ["wrong-key", "parse", "snippet_x", "snippet-Raw", "snippet-", "snippet-a--b"]) {
      const text = `// #region ${name}\nx\n// #endregion ${name}`
      expect(regionProblems("a.ts", text).some((problem) => problem.includes("must be \"snippet\" or \"snippet-<name>\""))).toBe(true)
    }
  })
})

describe("one name per file", () => {
  test("a duplicate name is reported with both lines", () => {
    const problems = regionProblems("curl/chat.sh", "# region snippet\na\n# endregion snippet\n# region snippet\nb\n# endregion snippet")
    expect(problems).toEqual(['curl/chat.sh:4: region "snippet" is also declared on line 1; each name must appear once per file'])
  })
})

describe("endregion pairing", () => {
  test("an endregion that names another region is reported", () => {
    const problems = regionProblems("a.ts", "// #region snippet-a\nx\n// #endregion snippet-b")
    expect(problems).toEqual(['a.ts:3: endregion "snippet-b" closes region "snippet-a" (line 1)'])
  })

  test("an endregion with no region open is reported", () => {
    expect(regionProblems("a.py", "x\n# endregion snippet")).toEqual(['a.py:2: endregion "snippet" has no region open'])
  })

  test("a region that is never closed is reported", () => {
    expect(regionProblems("a.py", "# region snippet\nx")).toEqual(['a.py:1: region "snippet" is never closed'])
  })

  test("a region inside another is reported (regions do not nest)", () => {
    const problems = regionProblems("a.py", "# region snippet\n# region snippet-x\n# endregion snippet-x\n# endregion snippet")
    expect(problems).toEqual(['a.py:2: region "snippet-x" starts inside region "snippet" (line 1); regions do not nest'])
  })
})
