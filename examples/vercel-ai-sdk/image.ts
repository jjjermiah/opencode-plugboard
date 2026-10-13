// S5, image as a data URL in a multi-part user message.
import { readFileSync } from "node:fs"
import { generateText } from "ai"
import type { Client } from "./providers.ts"

const RED = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim()

export async function run(client: Client, model: string) {
  // #region snippet
  const { text } = await generateText({
    model: client(model),
    maxOutputTokens: 1024,
    messages: [{ role: "user", content: [{ type: "text", text: "What color is this image? One word." }, { type: "file", data: RED, mediaType: "image/png" }] }],
  })
  // #endregion snippet
  return { text }
}

if (import.meta.main) {
  const { apis } = await import("./providers.ts")
  console.log(JSON.stringify(await run(apis.compat, "fast")))
}
