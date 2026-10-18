#!/usr/bin/env bun
// Prints the published `@opencode/plugin` versions the host matrix runs against, as a JSON
// array: the stable versions inside the peer range in package.json, cut to the oldest, the
// middle one and the newest when there are more than three. Not shipped in the package.
//
//   bun .github/scripts/host-versions.ts            # ["2.0.26","2.0.27"]
//   bun .github/scripts/host-versions.ts --latest   # newest in range, as plain text
import { readFileSync } from "node:fs"

const PACKAGE = "@opencode/plugin"
const range = (JSON.parse(readFileSync("package.json", "utf8")) as { peerDependencies: Record<string, string> }).peerDependencies[PACKAGE]
if (!range) throw new Error(`package.json has no peer range for ${PACKAGE}`)

const run = Bun.spawnSync(["npm", "view", PACKAGE, "versions", "--json"], { stderr: "inherit" })
if (run.exitCode !== 0) throw new Error(`npm view ${PACKAGE} versions failed with exit code ${run.exitCode}`)
const published = JSON.parse(run.stdout.toString()) as string[]

const inRange = published.filter((v) => !v.includes("-") && Bun.semver.satisfies(v, range)).sort((a, b) => Bun.semver.order(a, b))
if (!inRange.length) throw new Error(`no published ${PACKAGE} version satisfies ${range}`)

if (process.argv.includes("--latest")) {
  console.log(inRange[inRange.length - 1])
} else {
  const picked = inRange.length <= 3 ? inRange : [inRange[0], inRange[Math.floor(inRange.length / 2)], inRange[inRange.length - 1]]
  console.log(JSON.stringify(picked))
}
