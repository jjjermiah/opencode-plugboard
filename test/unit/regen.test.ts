/**
 * What `bun run regen` does to a conflicted floors file (.github/scripts/regen.ts): per-key maximum of both sides,
 * and no change when there is no conflict.
 */
import { describe, expect, test } from "bun:test"
import { conflictSides, hasConflict, resolveFloors } from "../../.github/scripts/regen.ts"

const conflicted = (ours: string, theirs: string, base = "") =>
  ["{", "<<<<<<< HEAD", ours, ...(base ? ["||||||| merged common ancestors", base] : []), "=======", theirs, ">>>>>>> origin/main", "}", ""].join("\n")

describe("regen: floors", () => {
  test("a file without markers is left alone", () => {
    expect(hasConflict('{\n  "unit": 1\n}\n')).toBe(false)
    expect(resolveFloors('{\n  "unit": 1\n}\n')).toBeUndefined()
  })

  test("a conflict takes the higher value per key, and keys only one side has", () => {
    const text = ["{", '  "compat": 250,', "<<<<<<< HEAD", '  "http": 790,', '  "unit": 1500', "=======", '  "http": 783,', '  "session": 426,', '  "unit": 1524', ">>>>>>> origin/main", "}", ""].join(
      "\n",
    )
    expect(JSON.parse(resolveFloors(text)!)).toEqual({ compat: 250, http: 790, session: 426, unit: 1524 })
  })

  test("the diff3 base block is not read as a side", () => {
    const text = conflicted('  "unit": 1530', '  "unit": 1524', '  "unit": 9999')
    expect(conflictSides(text).ours).toContain("1530")
    expect(conflictSides(text).theirs).not.toContain("9999")
    expect(JSON.parse(resolveFloors(text)!)).toEqual({ unit: 1530 })
  })

  test("the result is the file format validate writes: sorted keys, two-space indent, trailing newline", () => {
    expect(resolveFloors(conflicted('  "b": 2', '  "a": 1'))).toBe('{\n  "a": 1,\n  "b": 2\n}\n')
  })

  test("a side that is not a JSON object of numbers is refused", () => {
    expect(() => resolveFloors(conflicted('  "unit": "many"', '  "unit": 1'))).toThrow("ours")
    expect(() => resolveFloors(conflicted('  "unit": 1,', '  "unit": 2'))).toThrow()
  })
})
