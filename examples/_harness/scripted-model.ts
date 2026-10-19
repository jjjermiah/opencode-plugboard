/**
 * The scripted model behind `scripted-server.ts`. It answers only the prompts in `_shared/scenarios.json`,
 * so a scripted run is byte-identical from one run to the next. Anything else gets an error event, which
 * fails the scenario instead of inventing an answer.
 *
 * Built on `FakeModelCaller` and `ev` from test/support, the same fake the HTTP tests use.
 */
import type { PlugEvent, PlugRequest } from "../../src/contract.js"
import { FakeModelCaller } from "../../test/support/model-caller.js"
import { ev } from "../../test/support/fixtures.js"
import scenarios from "../_shared/scenarios.json" with { type: "json" }

const CALL_ID = "call_scripted_1"
const USAGE = { inputTokens: 11, outputTokens: 7 }
/** The meal the model estimates, as text and as a forced tool's arguments. */
export const MEAL = { calories: 180, protein_g: 13 }

const prompt = (id: string): string => scenarios.scenarios.find((s) => s.id === id)?.prompt ?? ""
const userText = (request: PlugRequest): string =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
const hasPngPart = (request: PlugRequest): boolean =>
  request.messages.some((message) => message.content.some((part) => part.type === "media" && part.url.startsWith("data:image/png")))
const answered = (request: PlugRequest): boolean => request.messages.some((message) => message.role === "tool")
/**
 * The review PR-Agent's `/review` gets (examples/pr-agent). Its user prompt holds a `--PR Info--` header and a `The PR code diff:` block, which no
 * other client sends. The finding below is what the example's runner looks for in the `review.md` the local git provider writes.
 */
export const PR_REVIEW = { header: "Scripted finding", content: "The scripted model reviewed this diff and found nothing to change." }
const PR_REVIEW_YAML = `review:
  estimated_effort_to_review_[1-5]: 1
  relevant_tests: |
    No
  key_issues_to_review:
    - relevant_file: |
        hello.py
      issue_header: |
        ${PR_REVIEW.header}
      issue_content: |
        ${PR_REVIEW.content}
      start_line: 2
      end_line: 2
  security_concerns: |
    No
`
const isPrAgentReview = (text: string): boolean => text.includes("--PR Info--") && text.includes("The PR code diff:")

/** n8n's Structured Output Parser puts its schema in the prompt, with the answer wrapped in `output` (#344). Other clients send no such text. */
const wantsOutputWrapper = (text: string): boolean => text.includes('"properties":{"output"')

/** Text as two deltas, so a streaming client has to accumulate. */
function say(answer: string): PlugEvent[] {
  const half = Math.ceil(answer.length / 2)
  return [ev.text(answer.slice(0, half)), ev.text(answer.slice(half)), ev.finish("stop", USAGE)]
}

/**
 * Aider's edit reply to S11, in the format its prompt asks for. A model Aider knows to prefer `diff` gets SEARCH/REPLACE blocks; any other
 * gets the whole file. Aider's file is `hello.py`, which holds `print("hi")`.
 */
function aiderEdit(prompts: string): PlugEvent[] {
  const fence = "```"
  if (prompts.includes("SEARCH/REPLACE")) {
    return say(`I will change the greeting.\n\nhello.py\n${fence}python\n<<<<<<< SEARCH\nprint("hi")\n=======\nprint("hello from plugboard")\n>>>>>>> REPLACE\n${fence}\n`)
  }
  return say(`I will change the greeting.\n\nhello.py\n${fence}\nprint("hello from plugboard")\n${fence}\n`)
}

const propertiesOf = (schema: unknown): object => (schema as { properties?: object } | undefined)?.properties ?? {}

/**
 * The tool a request forces, if any. A named choice always forces its tool. `required` forces only when there is exactly
 * one tool the scripted model can fill (a `calories` property, the meal), and only before any tool result, so a forced
 * answer cannot loop. Any other `required` request takes the same paths as `auto`.
 */
function forcedTool(request: PlugRequest): string | undefined {
  if (typeof request.toolChoice === "object") return request.toolChoice.name
  if (request.toolChoice !== "required" || answered(request)) return undefined
  const [tool] = request.tools
  return tool && "calories" in propertiesOf(tool.parameters) ? tool.name : undefined
}

/** The events of one model call for `request`. */
export function answer(request: PlugRequest): PlugEvent[] {
  const forced = forcedTool(request)
  if (forced) {
    const input = "calories" in propertiesOf(request.tools.find((tool) => tool.name === forced)?.parameters) ? MEAL : {}
    return [ev.call(CALL_ID, forced, input), ev.finish("tool-calls", USAGE)]
  }
  const text = userText(request)
  if (isPrAgentReview(text)) return say(PR_REVIEW_YAML)
  // DSPy's chat adapter wraps the question and wants the answer in a `[[ ## answer ## ]]` field, after `reasoning` when the
  // signature asks for it. Other clients never send these markers, so their answers are unchanged.
  if (text.includes("[[ ## ")) {
    const reasoning = text.includes("`[[ ## reasoning ## ]]`") ? "[[ ## reasoning ## ]]\nThe answer is requested.\n\n" : ""
    if (text.includes(prompt("S1"))) return say(`${reasoning}[[ ## answer ## ]]\npong\n\n[[ ## completed ## ]]`)
    if (text.includes(prompt("S6"))) return say(`${reasoning}[[ ## answer ## ]]\n${JSON.stringify(MEAL)}\n\n[[ ## completed ## ]]`)
  }
  if (text.includes(prompt("S1"))) return say("pong")
  if (text.includes(prompt("S2"))) {
    // smolagents sends the tool result as user text ("Observation:") and ends a run only with a final_answer call (#370).
    if (text.includes("Observation:") && request.tools.some((tool) => tool.name === "final_answer")) {
      return [ev.call(CALL_ID, "final_answer", { answer: "18 C and cloudy" }), ev.finish("tool-calls", USAGE)]
    }
    if (answered(request)) return say("18 C and cloudy")
    // Semantic Kernel prefixes plugin functions on the wire (weather-get_weather), and Codex prefixes an MCP tool with its
    // server (mcp__weather__get_weather). Answer with the name the client sent.
    const weather = request.tools.find((tool) => tool.name === "get_weather" || tool.name.endsWith("-get_weather") || tool.name.endsWith("__get_weather"))
    if (weather && request.toolChoice !== "none") {
      return [ev.call(CALL_ID, weather.name, { city: "Paris" }), ev.finish("tool-calls", USAGE)]
    }
    // A model Codex knows works in code mode: MCP tools are not offered, they are called from JavaScript run by the `exec` freeform
    // tool (a custom tool, which plugboard gives the model as a function taking one `input` string, #498).
    if (request.tools.some((tool) => tool.name === "exec") && request.toolChoice !== "none") {
      return [ev.call(CALL_ID, "exec", { input: 'text(JSON.stringify(await tools.mcp__weather__get_weather({ city: "Paris" })))' }), ev.finish("tool-calls", USAGE)]
    }
  }
  if (text.includes(prompt("S11"))) return aiderEdit(`${request.system.join("\n")}\n${text}`)
  if (text.includes(prompt("S5"))) return say(hasPngPart(request) ? "red" : "no image")
  if (text.includes(prompt("S6"))) return say(JSON.stringify(wantsOutputWrapper(text) ? { output: MEAL } : MEAL))
  return [ev.error({ status: 500, kind: "server", message: `scripted model has no answer for this prompt: ${text.slice(0, 80)}` })]
}

export const scriptedModel = new FakeModelCaller((request) => answer(request))
