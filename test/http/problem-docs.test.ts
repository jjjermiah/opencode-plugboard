/**
 * #254: every code that the `/plugboard/` routes can answer with has an anchor in `docs/errors.md`,
 * so the `type` URI of a problem always resolves. Kept out of the route tests: the mutation harness
 * copies `src` and `test` but not `docs`, and it runs only the files a mutation names.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { PROBLEM_CODES } from "../../src/http.js"

describe("#254 the problem types resolve", () => {
  test("#254 every problem code has an anchor in docs/errors.md, and no anchor lacks its code", () => {
    const page = readFileSync(join(import.meta.dir, "../../docs/errors.md"), "utf8")
    const anchors = [...page.matchAll(/\{#([a-z-]+)\}/g)].map((match) => match[1]!)
    for (const code of PROBLEM_CODES) expect(anchors).toContain(code.replaceAll("_", "-"))
    expect(anchors.sort()).toEqual([...PROBLEM_CODES].map((code) => code.replaceAll("_", "-")).sort())
  })
})
