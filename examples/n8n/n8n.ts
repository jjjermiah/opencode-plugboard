/**
 * The n8n instance the scenarios drive. `apiKey` is a public-API key (workflows, executions); `cookie` is the owner's
 * session, for the internal REST routes the model dropdown uses. Both are created by run.ts at the start of a run.
 */
export interface N8n {
  readonly base: string
  readonly apiKey: string
  readonly cookie: string
  /** The OpenAI credential the workflows use (pointed at plugboard). */
  readonly credentialId: string
}

export interface Reply {
  readonly status: number
  readonly json: unknown
  readonly text: string
}

/**
 * The instance from the environment, for a scenario file run on its own: N8N_BASE, N8N_API_KEY, N8N_COOKIE (the
 * owner's session, only the model list needs it) and N8N_CREDENTIAL_ID. The runner builds the same object itself.
 */
export function fromEnv(): N8n {
  const base = process.env.N8N_BASE
  const apiKey = process.env.N8N_API_KEY
  const credentialId = process.env.N8N_CREDENTIAL_ID
  if (!base || !apiKey || !credentialId) throw new Error("set N8N_BASE, N8N_API_KEY and N8N_CREDENTIAL_ID")
  return { base, apiKey, cookie: process.env.N8N_COOKIE ?? "", credentialId }
}

/** Reads a path out of a parsed body, or undefined. */
export function at(value: unknown, ...keys: Array<string | number>): unknown {
  return keys.reduce<unknown>((node, key) => (node !== null && typeof node === "object" ? (node as Record<string | number, unknown>)[key] : undefined), value)
}

async function send(url: string, headers: Record<string, string>, method: string, body?: unknown): Promise<Reply> {
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text }
}

/** A call to the public API (`/api/v1`), authenticated with the API key. */
export function api(n8n: N8n, method: string, path: string, body?: unknown): Promise<Reply> {
  return send(`${n8n.base}${path}`, { "x-n8n-api-key": n8n.apiKey, "content-type": "application/json" }, method, body)
}

/** A call to the internal REST API (`/rest`), authenticated with the owner's session cookie. */
export function rest(n8n: N8n, method: string, path: string, body?: unknown): Promise<Reply> {
  return send(`${n8n.base}${path}`, { cookie: n8n.cookie, "content-type": "application/json" }, method, body)
}

/** The id of the workflow with this name (the JSON `name` is the webhook path, too). */
export async function workflowId(n8n: N8n, name: string): Promise<string> {
  const list = await api(n8n, "GET", "/api/v1/workflows?limit=250")
  const id = (at(list.json, "data") as Array<{ id: string; name: string }> | undefined)?.find((workflow) => workflow.name === name)?.id
  if (!id) throw new Error(`no workflow named ${name}`)
  return id
}

/** Calls a workflow's production webhook. The answer is the workflow's last node, or its NDJSON stream. */
export async function webhook(n8n: N8n, path: string, body: unknown): Promise<Reply> {
  return send(`${n8n.base}/webhook/${path}`, { "content-type": "application/json" }, "POST", body)
}

/**
 * The newest execution of a workflow, with its run data, once n8n has finished saving it. Webhook answers come
 * before the save, so this polls. Used for everything n8n does not put in the webhook answer: the model's finish
 * reasons and token usage, and the tool call.
 */
export async function lastExecution(n8n: N8n, workflow: string): Promise<Record<string, any>> {
  const id = await workflowId(n8n, workflow)
  const list = await api(n8n, "GET", `/api/v1/executions?workflowId=${id}&limit=1`)
  const executionId = at(list.json, "data", 0, "id")
  for (let attempt = 0; attempt < 60; attempt++) {
    const execution = await api(n8n, "GET", `/api/v1/executions/${executionId}?includeData=true`)
    // An execution that failed is not `finished`, so any terminal status ends the wait.
    if (at(execution.json, "finished") === true || ["success", "error", "crashed", "canceled"].includes(String(at(execution.json, "status")))) {
      return execution.json as Record<string, any>
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`execution ${executionId} of ${workflow} did not finish`)
}

/** One model turn in an execution, in order: the finish reason the model gave and its token usage. */
export interface Turn {
  readonly finish_reason: string | null
  readonly usage: unknown
}

/** The model turns of an execution, read from the chat model node's run data (`ai_languageModel`). */
export function turns(execution: Record<string, any>): Turn[] {
  const runs = (at(execution, "data", "resultData", "runData", "OpenAI Chat Model") as Array<Record<string, any>> | undefined) ?? []
  return runs.map((run) => {
    const json = at(run, "data", "ai_languageModel", 0, 0, "json")
    // The Responses path records no finish reason, and its tokenUsageEstimate is n8n's guess, not the provider's usage.
    return {
      finish_reason: (at(json, "response", "generations", 0, 0, "generationInfo", "finish_reason") as string | undefined) ?? null,
      usage: at(json, "tokenUsage") ?? null,
    }
  })
}

/** The tool call an AI Agent made in an execution: the tool's name, its city argument, and n8n's id for the action. */
export function toolCall(execution: Record<string, any>): { name: string; city: unknown; id: string } | null {
  const action = at(execution, "data", "resultData", "runData", "AI Agent", 0, "metadata", "subNodeExecutionData", "actions", 0, "action")
  if (!action) return null
  // The Code tool takes one argument. The model names it (`input` from the Code tool's schema); read the value, not the key.
  const args = at(action, "input") as Record<string, unknown> | undefined
  const city = args ? (Object.values(args).find((value) => typeof value === "string") ?? null) : null
  return { name: String(at(action, "nodeName")), city, id: String(at(action, "id")) }
}
