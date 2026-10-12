/**
 * Configuration of the live suite (#99) and the provider x endpoint matrix (#108). Everything comes
 * from the environment; the key is never read from a file and never written to a report.
 */
import { join } from "node:path"

/** The suite runs only when this is "1"; `bun test` stays offline otherwise. */
export const LIVE = process.env.PLUGBOARD_LIVE === "1"

/** Plugboard on the isolated server. */
export const LIVE_URL = process.env.PLUGBOARD_LIVE_URL ?? "http://127.0.0.1:4010"

/** An app key on that server (the dev server's `compat` app). */
export const LIVE_KEY = process.env.PLUGBOARD_LIVE_KEY ?? ""

/** One cheap model per logged-in provider. Ids checked against `GET /v1/models` on the dev server. */
export const DEFAULT_MODELS = ["opencode-go/glm-5.3-flash", "anthropic/claude-haiku-4-5", "openai/gpt-5.6-luna#low", "github-copilot/gpt-5.5"]

export const LIVE_MODELS = process.env.PLUGBOARD_LIVE_MODELS
  ? process.env.PLUGBOARD_LIVE_MODELS.split(",").map((model) => model.trim()).filter(Boolean)
  : DEFAULT_MODELS

/**
 * The real home directory. `test/setup.ts` moves HOME into a sandbox for `bun test`, and the wrapper
 * finds the isolated server's directories under the real home, so the suite passes it on explicitly.
 */
export const REAL_HOME = process.env.PLUGBOARD_REAL_HOME ?? process.env.HOME ?? ""

/**
 * The wrapper that runs OpenCode against the isolated server (`OC_DEV=1`, its own HOME and XDG dirs).
 * Only this command is used to reach that server; the suite never edits its config.
 */
export const OC = process.env.PLUGBOARD_LIVE_OC ?? join(REAL_HOME, ".cache/opencode-adapter-dev/oc")

/**
 * The checkout the isolated server loads plugboard from (its config's `package`). The report names its
 * version and commit, so a result can be tied to the code that produced it.
 */
export const CHECKOUT = process.env.PLUGBOARD_LIVE_CHECKOUT ?? join(REAL_HOME, "projects/repos/open-source/opencode-plugboard")

/** Small on purpose: reasoning models spend part of this budget before any visible text. */
export const MAX_TOKENS = 512
