// S14, compaction. Claude Code compacts a session by asking the model to summarise it, then replaces the old turns with that
// summary. A headless run has no session to compact, so the scenario makes one: a first turn, then `/compact` on the same session
// (`--resume`), then a turn on the compacted session. The scripted model's last answer says what history it was sent.
import { claude, textOf } from "./cli.ts"
import scenarios from "../_shared/scenarios.json" with { type: "json" }

const prompt = scenarios.scenarios.find((scenario) => scenario.id === "S14")?.prompt ?? ""

export async function run() {
  const first = await claude(prompt)
  const compact = await claude("/compact", ["--resume", first.sessionId])
  const resumed = await claude(prompt, ["--resume", first.sessionId])
  const boundary = compact.events.some((event) => event.type === "system" && event.subtype === "compact_boundary")
  return {
    first_text: first.result.result ?? "",
    compacted: boundary,
    summary_text: compact.events.filter((event) => event.type === "user").map(textOf).join("\n"),
    resumed_text: resumed.result.result ?? "",
    is_error: first.result.is_error === true || compact.result.is_error === true || resumed.result.is_error === true,
  }
}
