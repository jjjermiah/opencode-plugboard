// Runner for the Claude Code example. Started by examples/_harness/run.ts, which captures the traffic and writes the run.
// The CLI is a child process: each scenario calls it through cli.ts, and the harness scores what it returned.
//
//   bun run.ts          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import { cliHome, cliVersion } from "./cli.ts"
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import * as compact from "./compact.ts"
import * as tools from "./tools.ts"

const NOT_CLI = "the CLI runs its own tools, so a custom get_weather function cannot be added to a headless run"
const NO_IMAGE = "the CLI takes an image only as a file it reads, not a data URL, so S5 is not run through it"
const NO_JSON_SCHEMA = "the CLI has no JSON-schema output option for a chat-only run"
const NO_LIST = "the CLI does not list models"
const NO_ERRORS = "not run: the CLI prints API errors as text and retries, and its events carry no status"

cliHome()
emitClient("@anthropic-ai/claude-code", await cliVersion())

await runAll(
  {
    S1: (model) => chat.run("S1", model),
    S3: (model) => chat.run("S3", model),
    S11: () => tools.steps(),
    S12: () => tools.subagent(),
    S13: () => compact.run(),
  },
  {
    na: {
      S2: NOT_CLI,
      S4: NOT_CLI,
      S5: NO_IMAGE,
      S6: NO_JSON_SCHEMA,
      S7: NO_LIST,
      E1: NO_ERRORS,
      E2: NO_ERRORS,
    },
  },
)
