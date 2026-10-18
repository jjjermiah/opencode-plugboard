/**
 * The `(since next)` placeholder (.github/scripts/since-next.ts): the release script replaces it with the released version,
 * and CI refuses it inside a released CHANGELOG section. docs/releasing.md.
 */
import { describe, expect, test } from "bun:test"
import { hasSinceNext, placeholdersInReleased, replaceSinceNext } from "../../.github/scripts/since-next.ts"

describe("since-next: replacing the placeholder", () => {
  test("the parenthesised form and the sentence-start form become the version", () => {
    const text = "- New option `x` (since next).\n\nSince next, the default is on. Also: Since next it is faster.\n- Since next the flag works."
    expect(replaceSinceNext(text, "0.51.0")).toBe(
      "- New option `x` (since 0.51.0).\n\nSince 0.51.0, the default is on. Also: Since 0.51.0 it is faster.\n- Since 0.51.0 the flag works.",
    )
  })

  test("a real version marker and ordinary prose stay as written", () => {
    const text = "(since 0.50.0) and since next week we ship. Done since next Friday."
    expect(replaceSinceNext(text, "0.51.0")).toBe(text)
  })

  test("inline code and fenced blocks are left alone, so a doc can show the placeholder", () => {
    const text = ["Write `(since next)` in the notes (since next).", "", "```md", "- Added (since next)", "Since next, x", "```", "", "(since next)"].join("\n")
    expect(replaceSinceNext(text, "1.2.3")).toBe(
      ["Write `(since next)` in the notes (since 1.2.3).", "", "```md", "- Added (since next)", "Since next, x", "```", "", "(since 1.2.3)"].join("\n"),
    )
  })

  test("a tilde fence is code too", () => {
    expect(replaceSinceNext("~~~\n(since next)\n~~~\n(since next)", "1.2.3")).toBe("~~~\n(since next)\n~~~\n(since 1.2.3)")
  })

  test("hasSinceNext sees a placeholder in prose only", () => {
    expect(hasSinceNext("an option (since next)")).toBe(true)
    expect(hasSinceNext("Since next, it is on")).toBe(true)
    expect(hasSinceNext("`(since next)` in code")).toBe(false)
    expect(hasSinceNext("(since 0.50.0)")).toBe(false)
  })
})

describe("since-next: CI check", () => {
  const changelog = (unreleased: string, released: string) =>
    ["# Changelog", "", "## [Unreleased]", "", unreleased, "", "## [0.50.0] - 2026-10-17: Title", "", released, "", "## [0.49.0] - 2026-10-16: Older", "", "- old", "", "[Unreleased]: https://example.invalid/compare/v0.50.0...HEAD", ""].join("\n")

  test("a placeholder under [Unreleased] is fine", () => {
    expect(placeholdersInReleased(changelog("- Added a thing (since next).", "- Released (since 0.50.0)."))).toEqual([])
  })

  test("a placeholder in a released section is reported with its line", () => {
    const text = changelog("- Added a thing (since next).", "- Released (since next).")
    expect(placeholdersInReleased(text)).toEqual([text.split("\n").indexOf("- Released (since next).") + 1])
  })

  test("a placeholder in code inside a released section is not reported", () => {
    expect(placeholdersInReleased(changelog("- Nothing.", "- The marker is `(since next)`.\n\n```\n(since next)\n```"))).toEqual([])
  })

  test("every released section is checked, not only the newest", () => {
    const text = changelog("- Nothing.", "- Fine.").replace("- old", "- old (since next)")
    expect(placeholdersInReleased(text)).toHaveLength(1)
  })
})
