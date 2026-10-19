// S10, token count before a request. The CLI calls :countTokens itself, before it sends a prompt that holds inline data, an image or a PDF
// (its check that the request fits the model's context window). A text-only prompt is estimated inside the CLI and calls nothing.
// The count is not printed, so the observation is read from the exchange the capture proxy recorded.
import { fileURLToPath } from "node:url"
import { gemini, stageFile } from "./cli.ts"

const IMAGE = fileURLToPath(new URL("../_shared/red32.png", import.meta.url))

interface Exchange {
  readonly path: string
  readonly status: number
  readonly resBody: string
}

export async function run(home: string, model: string) {
  stageFile(IMAGE, "red32.png")
  // #region snippet
  // An @file reference to an image sends the file with the prompt. The CLI then calls POST /v1beta/models/<model>:countTokens
  // before :streamGenerateContent, with the same GEMINI_API_KEY and GOOGLE_GEMINI_BASE_URL.
  await gemini(home, model, "Reply with exactly: pong @red32.png", "json")
  // #endregion snippet
  const url = process.env.PLUGBOARD_CAPTURE_URL
  if (!url) throw new Error("PLUGBOARD_CAPTURE_URL is not set: run this through examples/_harness/run.ts")
  const exchanges = (await (await fetch(`${url}/__exchanges`)).json()) as Exchange[]
  const count = exchanges.find((exchange) => exchange.path.endsWith(":countTokens"))
  if (!count) throw new Error("the CLI did not call :countTokens")
  if (count.status !== 200) throw new Error(`:countTokens answered ${count.status}`)
  const totalTokens = (JSON.parse(count.resBody) as { totalTokens?: number }).totalTokens
  return { total_tokens: totalTokens, total_tokens_positive: typeof totalTokens === "number" && totalTokens > 0 }
}
