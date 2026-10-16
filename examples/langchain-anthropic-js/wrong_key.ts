// E1, wrong key (401 authentication_error). A ChatAnthropic built with a fixed fake key; the observations are the status and the error type.
import { errorObservations, wrongKeyModel } from "./errors.ts"

const PROMPT = "Reply with exactly: pong"

export async function run(model: string) {
  // #region snippet
  return errorObservations(() => wrongKeyModel(model).invoke(PROMPT))
  // #endregion snippet
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
