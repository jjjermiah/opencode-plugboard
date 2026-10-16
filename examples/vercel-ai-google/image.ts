// S5, image as a data URL in a multi-part user message.
import { generateText } from "ai"
import { readFileSync } from "node:fs"
import { type Client } from "./providers.ts"

export async function run(client: Client, model: string) {
  // #region snippet
  // A 32px red PNG as a data URL (examples/_shared/red32.dataurl.txt). The provider sends it as inline data.
  const red = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim()
  const result = await generateText({
    model: client(model),
    maxOutputTokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What color is this image? One word." },
          { type: "image", image: red, mediaType: "image/png" },
        ],
      },
    ],
  })
  // #endregion snippet
  return { text: result.text }
}

if (import.meta.main) {
  const { client } = await import("./providers.ts")
  console.log(JSON.stringify(await run(client, "fast")))
}
