// S5, image as base64 in an image block. The fixture is a data URL; the Messages API wants the bare base64 and the media type.
import { readFileSync } from "node:fs"
import { client } from "./providers.ts"

const RED = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim()
const BASE64 = RED.replace(/^data:image\/png;base64,/, "")

export async function run(model: string) {
  // #region snippet
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: BASE64 } },
          { type: "text", text: "What color is this image? One word." },
        ],
      },
    ],
  })
  // #endregion snippet
  const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("")
  return { text }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
