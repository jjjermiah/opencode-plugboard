#!/usr/bin/env bun
// Moves the pinned @opencode/plugin devDependency to a newer OpenCode host, with the `effect` that
// host pins, and widens the peer ranges to cover it. host-bump.yml runs it once a newer version is
// published; run it by hand in a scratch copy to dry-run a bump.
//
//   bun .github/scripts/host-bump.ts 2.0.27
//
// package.json is edited as text, so only the changed values move (bun add would reformat the
// file). bun install then refreshes bun.lock. Peer changes, each only when the new version needs one:
//   - effect: the new version is appended to the `||` list (`4.0.0-rc.112` -> `4.0.0-rc.112 || 4.0.1`).
//   - @opencode/plugin: a version past the range moves the upper bound to the next minor of the
//     new version (`>=2.0.26 <2.1` -> `>=2.0.26 <2.2` for 2.1.x). A new major is an error: that
//     needs a decision, not a script.
// Prints one line per change. Not shipped in the package.
import { readFileSync, writeFileSync } from "node:fs"

const PACKAGE = "@opencode/plugin"
const version = process.argv[2] ?? ""

function fail(message: string): never {
  console.error(`host-bump: ${message}`)
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`expected a stable version such as 2.0.27, got "${version}"`)

const view = Bun.spawnSync(["npm", "view", `${PACKAGE}@${version}`, "dependencies.effect"], {
  stdout: "pipe",
  stderr: "inherit",
})
if (view.exitCode !== 0) fail(`npm view ${PACKAGE}@${version} exited with ${view.exitCode}`)
const effect = view.stdout.toString().trim()
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(effect)) {
  fail(`${PACKAGE}@${version} pins no effect version (npm said "${effect}")`)
}

const path = "package.json"
let text = readFileSync(path, "utf8")

// Replaces one `"name": "value"` after the first `"section"` key. The sections come before the
// ones they could be confused with: devDependencies before peerDependencies, and the plain
// peerDependencies key never matches peerDependenciesMeta.
function setValue(section: string, name: string, next: (current: string) => string): void {
  const at = text.indexOf(`"${section}"`)
  if (at < 0) fail(`package.json has no ${section}`)
  const tail = text.slice(at)
  const re = new RegExp(`("${name}"\\s*:\\s*")([^"]*)(")`)
  const match = re.exec(tail)
  if (!match) fail(`package.json has no ${name} in ${section}`)
  const current = match[2]
  const replacement = next(current)
  if (replacement === current) {
    console.log(`${section} ${name}: "${current}" (unchanged)`)
    return
  }
  text = text.slice(0, at) + tail.replace(re, `$1${replacement}$3`)
  console.log(`${section} ${name}: "${current}" -> "${replacement}"`)
}

// 1. The pinned devDependencies: the host, and the effect it pins.
setValue("devDependencies", PACKAGE, () => version)
setValue("devDependencies", "effect", () => effect)

// 2. The peer ranges.
setValue("peerDependencies", "effect", (current) => (Bun.semver.satisfies(effect, current) ? current : `${current} || ${effect}`))
setValue("peerDependencies", PACKAGE, (current) => {
  if (Bun.semver.satisfies(version, current)) return current
  const [major, minor] = version.split(".").map(Number)
  const upper = /<(\d+)\.(\d+)$/.exec(current)
  const lower = /^(>=\d+\.\d+\.\d+) <\d+\.\d+$/.exec(current)
  if (!upper || !lower) fail(`cannot widen the ${PACKAGE} peer "${current}" by rule; decide it by hand`)
  if (Number(upper[1]) !== major) fail(`${version} is a new major (peer "${current}"); decide the peer range by hand`)
  return `${lower[1]} <${major}.${minor + 1}`
})

writeFileSync(path, text)

// 3. The lockfile follows package.json.
const install = Bun.spawnSync(["bun", "install"], { stdout: "inherit", stderr: "inherit" })
if (install.exitCode !== 0) fail(`bun install exited with ${install.exitCode}`)
console.log(`bumped ${PACKAGE} to ${version} and effect to ${effect}`)
