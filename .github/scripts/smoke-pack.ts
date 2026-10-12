#!/usr/bin/env bun
// Installs the packed tarball into a throwaway project the way a user's OpenCode would.
// effect and @opencode/plugin are optional peers, so the install must not contain them, and
// the host (stood in for by ./host) provides them. Runs smoke-probe.ts there: the entry must
// import, plugin setup must register and return synchronously against a spy context, and
// the plugin must use the host's effect with no copy of its own.
// Complements check-pack.ts, which only checks the file list. Not shipped in the package.
//
//   bun .github/scripts/smoke-pack.ts
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

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

// Modules OpenCode's TUI host provides at runtime (packages/tui/src/plugin/runtime-plugin-support.bun.ts).
// The installed TUI entry may import only these bare specifiers; anything else cannot resolve in a user's install.
const HOST_PROVIDED = new Set(["@opentui/solid", "@opentui/core", "solid-js", "solid-js/store", "@opencode/plugin/tui"])

// The compiled `./tui` entry (dist/tui.js, see build-tui.ts) must be present in the installed package,
// import only host-provided modules, have no JSX-runtime calls left, and resolve every relative import.
function checkTuiEntry(file: string) {
  const fail = (message: string) => {
    console.error(`smoke: ${message}`)
    process.exit(1)
  }
  if (!existsSync(file)) fail(`installed TUI entry is missing: ${file}`)
  const code = readFileSync(file, "utf8")
  for (const marker of ["jsx-runtime", "jsxDEV", "react/jsx"]) {
    if (code.includes(marker)) fail(`installed TUI entry still has JSX runtime code (${marker}); it must be compiled`)
  }
  const specifiers = [...code.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1])
  if (!specifiers.includes("@opentui/solid")) fail("installed TUI entry does not import @opentui/solid")
  for (const specifier of specifiers) {
    if (specifier.startsWith(".")) {
      const base = resolve(dirname(file), specifier)
      const candidates = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx")]
      if (!candidates.some((c) => existsSync(c))) fail(`installed TUI entry imports ${specifier}, which does not resolve`)
    } else if (!HOST_PROVIDED.has(specifier)) {
      fail(`installed TUI entry imports ${specifier}, which OpenCode's TUI host does not provide`)
    }
  }
  console.log(`tui entry ok: ${specifiers.length} imports, all host-provided or relative`)
}

try {
  // Built first: `npm pack --ignore-scripts` below skips prepack, and the TUI entry ships compiled.
  run(["bun", "run", "build:tui"], root)
  const packDir = join(work, "pack")
  mkdirSync(packDir)
  run(["npm", "pack", "--ignore-scripts", "--pack-destination", packDir], root)
  const tarball = readdirSync(packDir).find((f) => f.endsWith(".tgz"))
  if (!tarball) throw new Error("npm pack produced no tarball")

  const project = join(work, "project")
  mkdirSync(project)
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "plugboard-smoke", private: true, type: "module" }))
  run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(packDir, tarball)], project)
  // effect and @opencode/plugin are optional peers: a plain install must not pull them in (#190).
  for (const name of ["effect", "@opencode/plugin"]) {
    if (existsSync(join(project, "node_modules", ...name.split("/")))) {
      console.error(`smoke: npm installed ${name}; it is an optional peer and must not be installed with the plugin`)
      process.exit(1)
    }
  }
  if (!existsSync(join(project, "node_modules", "opencode-plugboard", "npm-shrinkwrap.json"))) {
    console.error("smoke: the installed package has no npm-shrinkwrap.json")
    process.exit(1)
  }
  checkTuiEntry(join(project, "node_modules", "opencode-plugboard", "dist", "tui.js"))

  // Stands in for OpenCode, which provides effect and @opencode/plugin to plugins. Same pins as the dev dependencies.
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    peerDependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  const host = join(project, "host")
  mkdirSync(host)
  writeFileSync(join(host, "package.json"), JSON.stringify({ name: "plugboard-smoke-host", private: true, type: "module" }))
  run(
    ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", `effect@${pkg.peerDependencies.effect}`, `@opencode/plugin@${pkg.devDependencies["@opencode/plugin"]}`],
    host,
  )

  copyFileSync(join(import.meta.dir, "smoke-probe.ts"), join(project, "probe.ts"))
  const probe = Bun.spawnSync(["bun", "probe.ts"], { cwd: project, stdout: "inherit", stderr: "inherit" })
  if (probe.exitCode !== 0) process.exit(1)
} finally {
  rmSync(work, { recursive: true, force: true })
}
