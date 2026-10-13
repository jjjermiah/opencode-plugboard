// S5, image as a data URL in a multi-part user message.
import { readFileSync } from "node:fs"
import { HumanMessage } from "@langchain/core/messages"
import { ChatOpenAI } from "@langchain/openai"

export async function run(client: { baseURL: string; apiKey: string }, model: string) {
  // #region snippet
  const RED = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim() // a 32-pixel red PNG
  const llm = new ChatOpenAI({
    model,
    apiKey: client.apiKey,
    configuration: { baseURL: client.baseURL },
    maxTokens: 1024,
    maxRetries: 0,
  })
  const reply = await llm.invoke([
    new HumanMessage({
      content: [
        { type: "text", text: "What color is this image? One word." },
        { type: "image_url", image_url: { url: RED } },
      ],
    }),
  ])
  // #endregion snippet
  return { text: typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content) }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run({ baseURL: process.env.PLUGBOARD_BASE_URL!, apiKey: process.env.PLUGBOARD_KEY! }, "fast")))
}
