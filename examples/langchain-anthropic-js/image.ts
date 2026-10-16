// S5, image as a data URL in a multi-part message. ChatAnthropic converts the data URL into an Anthropic image block.
import { readFileSync } from "node:fs"
import { HumanMessage } from "@langchain/core/messages"
import { chatModel } from "./llm.ts"

const RED = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim()

export async function run(model: string) {
  // #region snippet
  const message = await chatModel(model).invoke([
    new HumanMessage({ content: [{ type: "text", text: "What color is this image? One word." }, { type: "image_url", image_url: { url: RED } }] }),
  ])
  // #endregion snippet
  const text = typeof message.content === "string" ? message.content : message.content.map((part) => ("text" in part ? part.text : "")).join("")
  return { text }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
