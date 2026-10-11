/**
 * Preloaded before every test file (bunfig.toml). The suite must never read or write a real
 * OpenCode install or the real plugboard data root, so HOME and every XDG directory point into
 * one throwaway directory, removed when the run exits. `ensureAppDir` therefore creates app
 * directories under `$XDG_DATA_HOME/opencode-plugboard` inside the sandbox.
 */
import { afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "plugboard-test-"))
process.env.HOME = join(sandbox, "home")
process.env.XDG_CONFIG_HOME = join(sandbox, "config")
process.env.XDG_DATA_HOME = join(sandbox, "data")
process.env.XDG_STATE_HOME = join(sandbox, "state")
process.env.XDG_CACHE_HOME = join(sandbox, "cache")
process.env.PLUGBOARD_TEST_SANDBOX = sandbox

// A hook registered in a preload runs once, after every test file.
afterAll(() => rmSync(sandbox, { recursive: true, force: true }))
