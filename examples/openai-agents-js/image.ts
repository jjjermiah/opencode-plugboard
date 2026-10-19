// S5, image as a data URL in a user message through the OpenAI Agents SDK on the Responses API.
import { readFileSync } from "node:fs"
import { Agent, run } from "@openai/agents"
import type OpenAI from "openai"
import { modelFor } from "./chat.ts"

export async function runImage(client: OpenAI, model: string) {
  // #region snippet
  // Any data:image/png;base64 URL works. This is a 32px red PNG (examples/_shared/red32.dataurl.txt).
  const red = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim()
  const agent = new Agent({ name: "color", model: modelFor(client, model), instructions: "Answer in one word." })
  const result = await run(agent, [
    {
      role: "user",
      content: [
        { type: "input_text", text: "What color is this image? One word." },
        { type: "input_image", image: red },
      ],
    },
  ])
  // #endregion snippet
  return { text: String(result.finalOutput ?? "") }
}
