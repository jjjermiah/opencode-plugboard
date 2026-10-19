// S11 and S12, a coding agent that works in several steps. Claude Code runs its own tools (Write, Read, Agent) and calls the model
// once per step, so one headless run is a chain of /v1/messages requests. The scripted model asks for the tools; the run checks
// what the CLI did with them.
import { claude, toolsUsed, workspaceFile } from "./cli.ts"
import scenarios from "../_shared/scenarios.json" with { type: "json" }

const prompt = (id: string): string => scenarios.scenarios.find((scenario) => scenario.id === id)?.prompt ?? ""

/** S11: Write a file, Read it back, answer. */
export async function steps() {
  const run = await claude(prompt("S11"))
  return {
    tools_used: toolsUsed(run.events),
    file_content: workspaceFile("notes.txt") ?? "",
    final_text: run.result.result ?? "",
    is_error: run.result.is_error ?? true,
  }
}

/** S12: the model calls the Agent tool, the CLI sends the sub-agent's own request to plugboard, and the answer comes back as a tool result. */
export async function subagent() {
  const run = await claude(prompt("S12"))
  // The CLI's own record of the sub-agent: the tool result it got back, with the text the sub-agent's model call returned.
  const handBack = run.events.find((event) => event.type === "user" && event.tool_use_result?.agentType)?.tool_use_result
  return {
    agent_called: toolsUsed(run.events).some((name) => name === "Agent" || name === "Task"),
    subagent_reply: (handBack?.content ?? []).map((block) => block.text ?? "").join("\n"),
    final_text: run.result.result ?? "",
    is_error: run.result.is_error ?? true,
  }
}
