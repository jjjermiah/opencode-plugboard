// S2 and S4, a tool call and its result: Codex has no option to add a function tool to a headless run, but it calls the tools of
// an MCP server in its config (weather-mcp.ts, one get_weather tool). Codex sends an MCP server's tools as one `namespace` tool,
// and plugboard accepts function tools only, so the first request is refused (#498).
import { codex } from "./cli.ts"

export async function run(model: string) {
  // #region snippet
  const events = await codex(model, "What is the weather in Paris? Use the tool.", true)
  // #endregion snippet
  const call = events.find((event) => event.type === "item.completed" && event.item?.type === "mcp_tool_call")?.item
  const args = (typeof call?.arguments === "string" ? JSON.parse(call.arguments) : call?.arguments) as { city?: string } | undefined
  const messages = events.filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
  return {
    tool_name: call?.tool ?? null,
    tool_city: args?.city ?? null,
    final_text: messages.at(-1)?.item?.text ?? "",
  }
}
