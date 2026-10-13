// S5, image as a data URL in a multi-part user message.
import OpenAI from "openai"
import { readFileSync } from "node:fs"

const RED = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim()

export async function run(client: OpenAI, model: string) {
  // #region snippet
  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What color is this image? One word." },
          { type: "image_url", image_url: { url: RED } },
        ],
      },
    ],
  })
  // #endregion snippet
  return { text: response.choices[0]?.message.content ?? "" }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client, "fast")))
}
