#!/usr/bin/env bun
// Installs the packed tarball into a throwaway project the way a user's OpenCode would
// (npm resolves the peer dependencies) and runs smoke-probe.ts there: the entry must
// import, plugin setup must register and return synchronously against a spy context,
// and `effect` and `@opencode/plugin` must resolve to a single copy.
// Complements check-pack.ts, which only checks the file list. Not shipped in the package.
//
//   bun .github/scripts/smoke-pack.ts
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), "plugboard-smoke-"))

function run(cmd: string[], cwd: string): string {
  console.log(`$ ${cmd.join(" ")}`)
  const result = Bun.spawnSync(cmd, { cwd, stderr: "inherit", stdout: "pipe" })
  if (result.exitCode !== 0) {
    console.error(`smoke: \`${cmd.join(" ")}\` exited with ${result.exitCode}`)
    process.exit(1)
  }
  return result.stdout.toString()
}

try {
  const packDir = join(work, "pack")
  mkdirSync(packDir)
  run(["npm", "pack", "--ignore-scripts", "--pack-destination", packDir], root)
  const tarball = readdirSync(packDir).find((f) => f.endsWith(".tgz"))
  if (!tarball) throw new Error("npm pack produced no tarball")

  const project = join(work, "project")
  mkdirSync(project)
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "plugboard-smoke", private: true, type: "module" }))
  run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(packDir, tarball)], project)
  console.log(run(["npm", "ls", "effect", "@opencode/plugin", "--all"], project))

  copyFileSync(join(import.meta.dir, "smoke-probe.ts"), join(project, "probe.ts"))
  const probe = Bun.spawnSync(["bun", "probe.ts"], { cwd: project, stdout: "inherit", stderr: "inherit" })
  if (probe.exitCode !== 0) process.exit(1)
} finally {
  rmSync(work, { recursive: true, force: true })
}
