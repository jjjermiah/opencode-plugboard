// E2, unknown model (404 not_found_error). The observations are the status and the error type.
import { errorObservations } from "./errors.ts"
import { chatModel } from "./llm.ts"

const PROMPT = "Reply with exactly: pong"

export async function run() {
  // #region snippet
  return errorObservations(() => chatModel("nope").invoke(PROMPT))
  // #endregion snippet
}

if (import.meta.main) {
  console.log(JSON.stringify(await run()))
}
