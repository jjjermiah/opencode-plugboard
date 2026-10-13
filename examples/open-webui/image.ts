// #region snippet
import { at, call, type Owui } from "./owui.ts"

/** S5: a red 32x32 PNG as a data URL, in an image_url part of a non-streamed chat. */
export async function run(owui: Owui, model: string) {
  const image = (await Bun.file(new URL("../_shared/red32.dataurl.txt", import.meta.url)).text()).trim()
  const { json } = await call(owui, "POST", "/api/chat/completions", {
    model,
    stream: false,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What color is this image? One word." },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
  })
  return { text: at(json, "choices", 0, "message", "content") }
}
// #endregion snippet

if (import.meta.main) {
  const owui: Owui = { base: process.env.OWUI_BASE!, token: process.env.OWUI_TOKEN!, upstream: process.env.OWUI_UPSTREAM ?? "" }
  console.log(JSON.stringify(await run(owui, process.env.MODEL ?? "fast")))
}
