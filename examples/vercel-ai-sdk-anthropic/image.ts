// S5, image as a data URL in a multi-part user message.
import { readFileSync } from "node:fs"
import { generateText } from "ai"
import { client, type Client } from "./providers.ts"

const RED = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim()

export async function run(model: string, make: Client = client) {
  // #region snippet
  const { text } = await generateText({
    model: make(model),
    maxOutputTokens: 1024,
    messages: [{ role: "user", content: [{ type: "text", text: "What color is this image? One word." }, { type: "file", data: RED, mediaType: "image/png" }] }],
  })
  // #endregion snippet
  return { text }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
