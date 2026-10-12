// Runs INSIDE the throwaway project that smoke-pack.ts installs the tarball into.
// effect and @opencode/plugin are optional peers, so the project does not have them: they
// come from ./host, which stands in for OpenCode. The probe loads the host's runtime the way
// OpenCode does (@opencode/plugin/runtime registers effect and @opencode/plugin for every
// import), then loads the plugin and runs its setup against a spy context. Checks the
// freeze-safety rules and that the plugin gets the host's effect with no copy of its own.
// Not shipped in the package.
import { existsSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"

const failures: string[] = []
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message)
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`)
}

const here = process.cwd()
const host = join(here, "host")

// ---- 0. Host runtime, before the plugin is imported. Bun.plugin then serves "effect" and
// "@opencode/plugin/*" from the host for every importer, as OpenCode does.
const runtime = (await import(Bun.resolveSync("@opencode/plugin/runtime", host))) as { ensurePluginRuntime: () => unknown }
runtime.ensurePluginRuntime()
const { Effect } = await import("effect")

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
    location: { directory: join(here, "not-a-plugboard-app") },
  },
  { get: (target, key) => (key in target ? target[key as keyof typeof target] : typeof key === "string" ? spy(key) : undefined) },
)

// ---- 3. Setup registers and returns synchronously. runSync throws on any async step,
// and the scope closing proves the finalizer is synchronous too.
let threw: unknown
const start = performance.now()
try {
  Effect.runSync(Effect.scoped((plugin.effect as (c: unknown) => any)(ctx)))
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

// ---- 4. Optional peers: the install has no effect or @opencode/plugin copy, and the plugin's
// effect is the host's instance.
const entryDir = dirname(realpathSync(Bun.resolveSync("opencode-plugboard/package.json", here)))
check(!existsSync(join(here, "node_modules", "effect")), "effect is not installed in the project (optional peer)")
check(!existsSync(join(here, "node_modules", "@opencode", "plugin")), "@opencode/plugin is not installed in the project (optional peer)")
for (const name of ["effect", "@opencode/plugin"]) {
  const copies = [...new Bun.Glob(`**/node_modules/${name}/package.json`).scanSync({ cwd: join(here, "node_modules") })]
  check(copies.length === 0, `no ${name} copy anywhere under node_modules (${copies.join(", ") || "none"})`)
}
const hostEffect = (await import(Bun.resolveSync("effect", host))) as { Effect: unknown }
check(hostEffect.Effect === Effect, "the effect the plugin uses is the host's instance")
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
