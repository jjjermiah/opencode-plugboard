// Runner for the Gemini CLI example. Started by examples/_harness/run.ts, which captures the traffic and writes the run.
// The CLI is a child process: each scenario calls it through cli.ts, and the harness scores what it returned.
//
//   bun run.ts          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import { cliHome, cliVersion } from "./cli.ts"
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import * as stream from "./stream.ts"

const NOT_CLI = "the CLI runs its own built-in tools; a custom get_weather tool cannot be added to a headless run"
const NO_JSON_SCHEMA = "the CLI has no JSON-schema output option"
const NO_IMAGE = "the CLI takes an image only as a file reference in the prompt, not a data URL, so S5 is not run through it"
const NO_LIST = "the CLI does not list models"
const NO_ERRORS = "not run: the CLI prints API errors as text, and its JSON output was not checked for a status"
const NO_FINISH = "the CLI's output carries no finish reason; the status is recorded as success or error"

const home = cliHome()
emitClient("@google/gemini-cli", await cliVersion())

await runAll(
  {
    S1: (model) => chat.run(home, model),
    S3: (model) => stream.run(home, model),
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
    unobserved: {
      S1: { "finish_reason is stop": NO_FINISH },
      S3: { "finish_reason is stop": NO_FINISH },
    },
  },
)
