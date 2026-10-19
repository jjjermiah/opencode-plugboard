// Runner for the Codex CLI example. Started by examples/_harness/run.ts, which captures the traffic and writes the run.
// The CLI is a child process: each scenario calls it through cli.ts, and the harness scores what it returned.
//
//   bun run.ts          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import { cliHome, cliVersion } from "./cli.ts"
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import * as stream from "./stream.ts"
import * as tools from "./tools.ts"

const NO_JSON_SCHEMA = "the CLI has no JSON-schema output option for a chat-only run"
const NO_IMAGE = "the CLI takes an image only as a file (-i), not a data URL, so S5 is not run through it"
const NO_LIST = "the CLI does not list models"
const NO_ERRORS = "not run: the CLI prints API errors as text, and its JSON events carry no status"
const NO_FINISH = "the CLI's events carry no finish reason; the turn is recorded as completed or failed"
const NO_CALL_ID = "the CLI's events carry no call id"
const NAMESPACE = {
  note: "Codex sends an MCP server's tools as a `namespace` tool, and plugboard accepts function tools only: the request gets a 400",
  issue: "#498",
}
const ADDITIONAL_TOOLS = {
  note: "for a model slug it knows, Codex sends its tools as an `additional_tools` input item, which plugboard refuses with a 400. An alias such as fast avoids it",
  issue: "#498",
}

cliHome()
emitClient("@openai/codex", await cliVersion())

await runAll(
  {
    S1: (model) => chat.run(model),
    S2: (model) => tools.run(model),
    S3: (model) => stream.run(model),
    S4: (model) => tools.run(model),
  },
  {
    gaps: { "S1|openai/gpt-5.6-luna#low": ADDITIONAL_TOOLS, "S2|openai/gpt-5.6-luna#low": ADDITIONAL_TOOLS, S2: NAMESPACE, S4: NAMESPACE },
    na: {
      S5: NO_IMAGE,
      S6: NO_JSON_SCHEMA,
      S7: NO_LIST,
      E1: NO_ERRORS,
      E2: NO_ERRORS,
    },
    unobserved: {
      S1: { "finish_reason is stop": NO_FINISH },
      S2: { "turn 1 finish_reason is tool_calls": NO_FINISH, "call id present": NO_CALL_ID, "turn 2 finish_reason is stop": NO_FINISH },
      S3: { "finish_reason is stop": NO_FINISH },
      S4: { "finish_reason is tool_calls": NO_FINISH, "call id present": NO_CALL_ID },
    },
  },
)
