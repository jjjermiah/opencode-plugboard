// #region snippet
import { at, fromEnv, rest, type N8n } from "./n8n.ts"

/**
 * S7: the model list as the credential's model dropdown shows it (n8n's searchModels, which calls GET /v1/models
 * through the credential). An empty filter returns every id, duplicates collapsed.
 */
export async function run(n8n: N8n) {
  const reply = await rest(n8n, "POST", "/rest/dynamic-node-parameters/resource-locator-results", {
    path: "model",
    nodeTypeAndVersion: { name: "@n8n/n8n-nodes-langchain.lmChatOpenAi", version: 1.3 },
    methodName: "searchModels",
    currentNodeParameters: { model: { __rl: true, mode: "list", value: "" }, options: {} },
    credentials: { openAiApi: { id: n8n.credentialId, name: "Plugboard" } },
    filter: "",
  })
  const ids = ((at(reply.json, "data", "results") as Array<{ value: string }> | undefined) ?? []).map((model) => model.value)
  return {
    model_ids: ids.length,
    has_fast: ids.includes("fast"),
    has_claude: ids.includes("anthropic/claude-haiku-4-5"),
    has_gpt_low: ids.includes("openai/gpt-5.6-luna#low"),
  }
}
// #endregion snippet

if (import.meta.main) {
  const n8n = fromEnv()
  console.log(JSON.stringify(await run(n8n)))
}
