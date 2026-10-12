/**
 * Route x request format x mode coverage manifest (#116).
 *
 * Every route the router serves, for each request format it takes, has one row; each row has one
 * cell per mode (json, stream, tools, images, structured output, n > 1, errors). A cell is:
 *   - `tests`: the tests that cover it, each a file plus a literal taken from a test title (or a
 *     table row name) in that file. The check fails when the file or the text is not there;
 *   - `na`: the mode does not exist for this route, with the reason;
 *   - `gap`: no test covers it yet; the reason must name the issue that tracks it (`#N`).
 *
 * `test/http/coverage-manifest.test.ts` fails when a route the router has has no row, a row names a
 * route the router does not have, a cell is empty, or a cover does not resolve. The router's route
 * names are read from the `src/**` route files (quoted `METHOD /path` literals); routes that are
 * spelled by a template or a constant (`MANUAL_ROUTES`) are probed on the live router instead.
 * `.github/scripts/coverage-manifest.ts --summary` prints the manifest in the CI job summary.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const root = join(import.meta.dir, "..")

export const MODES = ["json", "stream", "tools", "images", "structured", "n", "errors"] as const
export type Mode = (typeof MODES)[number]

export interface Cover {
  readonly file: string
  /** A literal from a test title or table row name in `file`. */
  readonly text: string
}
export type Cell = { readonly tests: readonly Cover[] } | { readonly na: string } | { readonly gap: string }
export interface Row {
  readonly route: string
  readonly format: string
  readonly cells: Readonly<Record<Mode, Cell>>
}

/** Routes spelled by a template or a constant in `src/`, not as a quoted `METHOD /path` literal. Probed live. */
export const MANUAL_ROUTES = ["GET /v1/models/{id}", "POST /v1/messages", "POST /v1/messages/count_tokens", "POST /v1beta/models/{model}:generateContent", "POST /v1beta/models/{model}:streamGenerateContent"] as const

const HTTP = "test/http/"
const UNIT = "test/unit/"
const at = (file: string, ...texts: string[]): Cell => ({ tests: texts.map((text) => ({ file, text })) })
const na = (reason: string): Cell => ({ na: reason })
const gap = (reason: string): Cell => ({ gap: reason })
/** A row for a route that takes no request body: only its answer and its errors can differ. */
const read = (route: string, json: Cell, errors: Cell): Row => ({
  route,
  format: "none",
  cells: { json, stream: na("a read has no stream"), tools: na("a read has no tools"), images: na("a read has no images"), structured: na("a read has no structured output"), n: na("a read has no n"), errors },
})

export const ROWS: readonly Row[] = [
  {
    route: "POST /v1/chat/completions",
    format: "openai-chat",
    cells: {
      json: at(HTTP + "chat.test.ts", "a text answer is a chat.completion"),
      stream: at(HTTP + "chat.test.ts", "a text answer streams chunks and ends with [DONE]"),
      tools: at(UNIT + "openai-response.test.ts", "tool calls become tool_calls with string arguments and force finish_reason tool_calls"),
      images: at(UNIT + "openai-request.test.ts", "user parts: text, image_url (data URL media type kept), file (bare base64 wrapped)"),
      structured: at(UNIT + "openai-response.test.ts", "structured: the answer is one content chunk; prose is suppressed; finish is stop"),
      n: at(HTTP + "fanout.test.ts", "one model call per choice, merged in choice order with summed usage and every session id"),
      errors: at(HTTP + "chat.test.ts", "a model error keeps its status and wire error", "#38 a failure before the first output keeps its HTTP status"),
    },
  },
  {
    route: "POST /v1/responses",
    format: "openai-responses",
    cells: {
      json: at(HTTP + "responses.test.ts", "a JSON answer is the response object, with x-plugboard-session"),
      stream: at(HTTP + "responses.test.ts", "a stream sends named events whose name matches the data type"),
      tools: at(UNIT + "responses-response.test.ts", "text then a tool call: the message closes before the function_call item, output indexes follow"),
      images: at(UNIT + "responses-request.test.ts", "user parts: input_text, input_image (and Chat-style image_url), input_file by data and URL"),
      structured: { tests: [{ file: UNIT + "responses-request.test.ts", text: "json_schema alone forces respond; with tools it requires a call" }, { file: UNIT + "responses-response.test.ts", text: "no respond call is a structured_output_missing failure" }] },
      n: na("the Responses body has no n parameter"),
      errors: at(HTTP + "responses.test.ts", "a failure keeps its HTTP status in a JSON answer", "#38 a stream failing before any output keeps its HTTP status"),
    },
  },
  {
    route: "POST /v1/completions",
    format: "openai-completions",
    cells: {
      json: at(HTTP + "fanout.test.ts", "a prompt is one user message; the answer is a text_completion"),
      stream: at(HTTP + "fanout.test.ts", "a stream: text chunks per choice, finish chunks, one [DONE]"),
      tools: na("legacy completions take no tools"),
      images: na("legacy completions take text prompts only"),
      structured: na("legacy completions have no response format"),
      n: at(HTTP + "fanout.test.ts", "a prompt list with n: choice i answers prompt floor(i / n), echo prefixes it"),
      errors: at(HTTP + "fanout.test.ts", "token-array prompts are a 400 before any model call"),
    },
  },
  {
    route: "POST /v1/messages",
    format: "anthropic",
    cells: {
      json: at(HTTP + "messages.test.ts", "a JSON answer is an Anthropic message with x-plugboard-session"),
      stream: at(HTTP + "messages.test.ts", "a stream is Anthropic's named event sequence, with no [DONE]"),
      tools: { tests: [{ file: UNIT + "anthropic-response.test.ts", text: "a tool call is one tool_use block with the whole input as one input_json_delta; stop_reason tool_use" }, { file: UNIT + "anthropic-request.test.ts", text: "a tool round trip: tool_use becomes a call" }] },
      images: at(UNIT + "anthropic-request.test.ts", "image and document blocks: base64 becomes a data URL, url passes through, a text document becomes text"),
      // The structured output request is refused with a 400, and the test pins that refusal.
      structured: at(UNIT + "anthropic-request.test.ts", "output_config.format (structured outputs)"),
      n: na("the Messages body has no n parameter"),
      errors: at(HTTP + "messages.test.ts", "a model error keeps its status in Anthropic's shape", "#38 a stream failing before output keeps its HTTP status"),
    },
  },
  {
    route: "POST /v1beta/models/{model}:generateContent",
    format: "gemini",
    cells: {
      json: at(HTTP + "gemini.test.ts", "a JSON answer is a GenerateContentResponse with x-plugboard-session"),
      stream: na("generateContent is the whole answer; streaming is streamGenerateContent"),
      tools: gap("the JSON tool-call answer has no test: test/unit/gemini-response.test.ts covers the streamed encoder only (#116)"),
      images: at(UNIT + "gemini-request.test.ts", "inlineData becomes a data URL; fileData with an http(s) URI passes through"),
      structured: gap("the JSON structured answer has no test: test/unit/gemini-response.test.ts covers the streamed encoder only (#116)"),
      n: at(UNIT + "gemini-request.test.ts", "candidateCount 2"),
      errors: at(HTTP + "gemini.test.ts", "a model error keeps its status in Google's shape", "a missing key is a 401 in Google's error shape"),
    },
  },
  {
    route: "POST /v1beta/models/{model}:streamGenerateContent",
    format: "gemini",
    cells: {
      json: na("streamGenerateContent only streams"),
      stream: at(HTTP + "gemini.test.ts", "a stream is bare data chunks, no event names and no [DONE]"),
      tools: at(UNIT + "gemini-response.test.ts", "a tool call is a functionCall part with object args; Gemini reports STOP after one"),
      images: at(UNIT + "gemini-request.test.ts", "inlineData becomes a data URL; fileData with an http(s) URI passes through"),
      structured: at(UNIT + "gemini-response.test.ts", "structured output: the respond call's input is the text; a wrapped schema is unwrapped"),
      n: at(UNIT + "gemini-request.test.ts", "candidateCount 2"),
      errors: at(HTTP + "gemini.test.ts", "#38 a stream failing before output keeps its HTTP status", "#38 a stream failing after output ends with one Google error object"),
    },
  },
  read(
    "GET /v1/models",
    at(HTTP + "ingress.test.ts", "GET /v1/models and /v1/models/{id}"),
    at(HTTP + "ingress.test.ts", "is a 401 invalid_api_key and never reaches the model"),
  ),
  read(
    "GET /v1/models/{id}",
    at(HTTP + "ingress.test.ts", "GET /v1/models and /v1/models/{id}"),
    at(HTTP + "policy.test.ts", "/v1/models/{id}: a model outside the scope is the 404 model_not_found, inside it is served"),
  ),
  read(
    "GET /v1/status",
    at(HTTP + "policy.test.ts", "the setup page and /v1/status count only the caller's models"),
    at(HTTP + "observability.test.ts", "without a key, %s is a 401, so the surface cannot be mapped"),
  ),
  read("GET /", at(HTTP + "observability.test.ts", "the HTML page has a strict CSP, no framing, no sniffing, no caching"), at(HTTP + "observability.test.ts", "/healthz and the first-run pages stay open")),
  read("GET /v1", at(UNIT + "discovery.test.ts", "/metrics is listed only when enabled"), at(HTTP + "observability.test.ts", "/healthz and the first-run pages stay open")),
  read("GET /healthz", at(HTTP + "ingress.test.ts", "GET /healthz answers ok without auth and writes no log line"), na("healthz answers 200 on every request; it has no error path")),
  read("GET /metrics", at(UNIT + "metrics.test.ts", "the content type is the registry's (text format 0.0.4)"), at(HTTP + "observability.test.ts", "/metrics while disabled")),
  read(
    "GET /v1beta/models",
    at(HTTP + "gemini.test.ts", "GET /v1beta/models lists models/<id> entries; GET one by id; an unknown one is a Google 404"),
    at(HTTP + "policy.test.ts", "GET /v1beta/models and /v1beta/models/{model} follow the same scope"),
  ),
  read(
    "GET /v1beta/models/{model}",
    at(HTTP + "gemini.test.ts", "GET /v1beta/models lists models/<id> entries; GET one by id; an unknown one is a Google 404"),
    at(HTTP + "policy.test.ts", "GET /v1beta/models and /v1beta/models/{model} follow the same scope"),
  ),
  {
    route: "POST /v1/messages/count_tokens",
    format: "anthropic",
    cells: {
      json: at(HTTP + "messages.test.ts", "GET is a 405, Anthropic-shaped; count_tokens answers { input_tokens } (#143)"),
      stream: na("count_tokens answers one JSON object; it has no stream"),
      tools: na("tool schemas only add to the estimate; covered by the estimator unit tests"),
      images: na("images only add a fixed cost to the estimate"),
      structured: na("count_tokens has no output format"),
      n: na("count_tokens has no choices"),
      errors: at(HTTP + "messages.test.ts", "#137 an unauthenticated GET is a 401, not a 405, so the path is not revealed"),
    },
  },
  read(
    "GET /v1/usage",
    at(HTTP + "usage.test.ts", "the admin key reads every app, and may narrow to one or name an empty one"),
    at(HTTP + "usage.test.ts", "an app key sees only its own app; naming another app is a 403"),
  ),
]

/** Every route name in the `src/**` route files: quoted `METHOD /path` literals, as the routers spell them. */
export async function scanRouteNames(): Promise<string[]> {
  const names = new Set<string>()
  for await (const file of new Bun.Glob("src/**/route.ts").scan({ cwd: root })) {
    for (const match of readFileSync(join(root, file), "utf8").matchAll(/"((?:GET|POST|PUT|DELETE|PATCH) \/[^"\s]*)"/g)) names.add(match[1]!)
  }
  return [...names].sort()
}

/**
 * Everything wrong with the manifest against the router's routes (the scan plus the manual list).
 * Empty when the manifest is complete and every cover resolves.
 */
export function problems(rows: readonly Row[], routes: readonly string[], base = root): string[] {
  const out: string[] = []
  const known = new Set(rows.map((row) => row.route))
  const served = new Set(routes)
  for (const route of routes) if (!known.has(route)) out.push(`${route}: the router has this route and no manifest row`)
  for (const route of known) if (!served.has(route)) out.push(`${route}: a manifest row names a route the router does not have`)
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.route} ${row.format}`
    if (seen.has(key)) out.push(`${key}: duplicate row`)
    seen.add(key)
    for (const mode of MODES) {
      const cell = row.cells[mode]
      const where = `${row.route} [${row.format}] ${mode}`
      if ("tests" in cell) {
        if (cell.tests.length === 0) out.push(`${where}: no test covers it (an empty selection)`)
        for (const cover of cell.tests) {
          const path = join(base, cover.file)
          if (!existsSync(path)) out.push(`${where}: ${cover.file} does not exist`)
          else if (!readFileSync(path, "utf8").includes(cover.text)) out.push(`${where}: ${cover.file} has no test titled "${cover.text}"`)
        }
      } else if ("na" in cell) {
        if (cell.na.trim() === "") out.push(`${where}: n/a without a reason`)
      } else if (!/#\d+/.test(cell.gap)) out.push(`${where}: a gap must name its issue (#N)`)
    }
  }
  return out
}
