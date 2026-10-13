/** #347 `PACKAGE_VERSION` is the package.json version at the package root, read when `src/version.ts` loads. */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hostVersion, PACKAGE_VERSION, readPackageVersion } from "../../src/version.ts"

describe("#347 PACKAGE_VERSION", () => {
  test("is the version in package.json at the package root", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
    expect(PACKAGE_VERSION).toBe(pkg.version)
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  test("a package.json that cannot be read gives no version, and does not throw", () => {
    expect(readPackageVersion(new URL("file:///no/such/dir/package.json"))).toBeUndefined()
  })

  test("a package.json without a string version gives no version", () => {
    const dir = mkdtempSync(join(tmpdir(), "plugboard-pkg-"))
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }))
    expect(readPackageVersion(new URL(`file://${join(dir, "package.json")}`))).toBeUndefined()
  })
})

describe("#347 hostVersion", () => {
  test("a real host version is kept", () => {
    expect(hostVersion("2.0.27")).toBe("2.0.27")
  })

  test("absent, empty and the placeholders 'unknown' and 'local' are not versions", () => {
    for (const value of [undefined, "", "unknown", "local"]) expect(hostVersion(value)).toBeUndefined()
  })
})
