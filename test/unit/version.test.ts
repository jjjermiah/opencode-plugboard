/** #347 `PACKAGE_VERSION` is the package.json version at the package root, read when `src/version.ts` loads. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { PACKAGE_VERSION } from "../../src/version.ts"

describe("#347 PACKAGE_VERSION", () => {
  test("is the version in package.json at the package root", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
    expect(PACKAGE_VERSION).toBe(pkg.version)
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
