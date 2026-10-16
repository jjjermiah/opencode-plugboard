// S5, image as a data URL in a multi-part user message.
import OpenAI from "openai"
import { readFileSync } from "node:fs"

export async function run(client: OpenAI, model: string) {
  // #region snippet
  // Any data:image/png;base64 URL works. This is a 32px red PNG (examples/_shared/red32.dataurl.txt).
  const red = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim()
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What color is this image? One word." },
          { type: "image_url", image_url: { url: red } },
        ],
      },
    ],
    max_tokens: 1024,
  })
  // #endregion snippet
  return { text: response.choices[0]?.message.content ?? "" }
}

export async function runResponses(client: OpenAI, model: string) {
  // #region snippet-responses
  const red = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim()
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "What color is this image? One word." },
          { type: "input_image", image_url: red, detail: "auto" },
        ],
      },
    ],
    max_output_tokens: 1024,
  })
  // #endregion snippet-responses
  return { text: response.output_text }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client, "fast")))
}
