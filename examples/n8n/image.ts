// #region snippet
import { at, fromEnv, webhook, type N8n } from "./n8n.ts"

/** S5: a red 32x32 PNG as a data URL, sent to a Basic LLM Chain with the Image URL message type. */
export async function run(n8n: N8n, model: string) {
  const image = (await Bun.file(new URL("../_shared/red32.dataurl.txt", import.meta.url)).text()).trim()
  const answer = await webhook(n8n, "pb-s5-image", { model, prompt: "What color is this image? One word.", image })
  return { text: at(answer.json, "text") }
}
// #endregion snippet

if (import.meta.main) {
  const n8n = fromEnv()
  console.log(JSON.stringify(await run(n8n, process.env.MODEL ?? "fast")))
}
