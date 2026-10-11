// Runs INSIDE the throwaway project that smoke-pack.ts installs the tarball into.
// Loads the plugin the way a host would (import the package entry, run the plugin
// effect against a spy context) and checks the freeze-safety and single-copy rules.
// Not shipped in the package.
import { existsSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { Effect } from "effect"

const failures: string[] = []
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message)
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`)
}

// ---- 1. The entry imports and has the plugin shape.
const mod = (await import("opencode-plugboard")) as { default?: { id?: string; effect?: unknown } }
const plugin = mod.default
check(plugin?.id === "opencode-plugboard", "entry default export has id opencode-plugboard")
check(typeof plugin?.effect === "function", "entry default export has an effect factory")
if (typeof plugin?.effect !== "function") process.exit(1)

// ---- 2. Spy context: records every call, answers with synchronous Effects only.
const calls: string[] = []
const spy = (path: string): unknown =>
  new Proxy(() => undefined, {
    get: (_t, key) => (typeof key === "string" ? spy(`${path}.${key}`) : undefined),
    apply: () => {
      calls.push(path)
      return Effect.void
    },
  })
const port = await freePort()
const ctx = new Proxy(
  {
    options: { listen: { host: "127.0.0.1", port } },
    location: { directory: join(process.cwd(), "not-a-plugboard-app") },
  },
  { get: (target, key) => (key in target ? target[key as keyof typeof target] : typeof key === "string" ? spy(key) : undefined) },
)

// ---- 3. Setup registers and returns synchronously. runSync throws on any async step,
// and the scope closing proves the finalizer is synchronous too.
let threw: unknown
const start = performance.now()
try {
  Effect.runSync(Effect.scoped((plugin.effect as (c: unknown) => Effect.Effect<void, never, import("effect").Scope.Scope>)(ctx)))
} catch (error) {
  threw = error
}
check(threw === undefined, `plugin setup ran synchronously to completion${threw ? `: ${String(threw)}` : ""}`)
check(performance.now() - start < 1000, "plugin setup finished within 1s")
const expected = ["session.hook", "agent.transform", "tool.transform"]
check(
  expected.every((c) => calls.includes(c)),
  `setup registered ${expected.join(", ")} (spy saw: ${calls.join(", ") || "nothing"})`,
)
const forbidden = calls.filter((c) => /\.(list|create|prompt|interrupt|remove|reload|subscribe|scan|get|set)$/.test(c))
check(forbidden.length === 0, `setup made no host calls that wait or do work${forbidden.length ? `: ${forbidden.join(", ")}` : ""}`)

// ---- 4. One copy of effect and @opencode/plugin in the install.
const real = (p: string) => realpathSync(p)
const here = process.cwd()
const entryDir = dirname(real(Bun.resolveSync("opencode-plugboard/package.json", here)))
const pluginDir = dirname(real(Bun.resolveSync("@opencode/plugin/package.json", here)))
const effectFrom = (dir: string) => dirname(real(Bun.resolveSync("effect/package.json", dir)))
const effects = new Set([effectFrom(here), effectFrom(entryDir), effectFrom(pluginDir)])
check(effects.size === 1, `effect resolves to one copy from the project, the plugin and the host package (${[...effects].join(" | ")})`)
const pluginFrom = (dir: string) => dirname(real(Bun.resolveSync("@opencode/plugin/package.json", dir)))
check(pluginFrom(entryDir) === pluginDir, "@opencode/plugin resolves to one copy from the plugin and the project")
for (const name of ["effect", "@opencode/plugin"]) {
  const copies = [...new Bun.Glob(`**/node_modules/${name}/package.json`).scanSync({ cwd: here })]
  check(copies.length === 1, `exactly one ${name} directory in node_modules (${copies.join(", ")})`)
}
check(!existsSync(join(entryDir, "node_modules")), "the plugin has no nested node_modules")

if (failures.length) {
  console.error(`\nsmoke: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log("\nsmoke ok")
// The shared listener may be bound by now; the host would own its lifetime, not this probe.
process.exit(0)

async function freePort(): Promise<number> {
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const { port } = server
  server.stop(true)
  return port
}
