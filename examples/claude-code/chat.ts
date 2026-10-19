// S1 and S3, a chat. Claude Code streams every call, so the two scenarios are the same call: a prompt, a streamed answer, the
// stop reason and the token usage the CLI reports.
import { claude } from "./cli.ts"
import scenarios from "../_shared/scenarios.json" with { type: "json" }

const prompt = (id: string): string => scenarios.scenarios.find((scenario) => scenario.id === id)?.prompt ?? ""

/** The CLI reports Anthropic's stop reason; the scenarios name it the OpenAI way. */
const finish = (reason: string | null | undefined): string | null => (reason === "end_turn" ? "stop" : (reason ?? null))

export async function run(id: "S1" | "S3", model: string) {
  const { result } = await claude(prompt(id), [], model)
  return {
    text: result.result ?? "",
    finish_reason: finish(result.stop_reason),
    usage: result.usage ?? null,
    done: result.is_error === false,
  }
}
