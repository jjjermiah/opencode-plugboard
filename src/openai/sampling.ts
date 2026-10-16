/**
 * Sampling parameters a model is known to reject.
 *
 * OpenAI clients send `temperature`, `top_p` and the penalties as if every model took them, but
 * some providers answer a 400 for them. The OpenCode host passes them through untouched, so
 * plugboard drops the ones a rule below says the model refuses and reports each drop in the
 * `x-plugboard-dropped-params` response header (option `dropUnsupportedParams` turns this off).
 *
 * The rules are an observed table, not a specification: each line says what the provider answered
 * when it was probed (OpenCode 2.0.26, October 2026). A model no rule matches keeps every
 * parameter, so a new model that rejects one still fails with the provider's own 400.
 */
import type { AppPolicy } from "../config.js"
import type { ModelRef, PlugGeneration } from "../contract.js"

type Param = "temperature" | "topP" | "frequencyPenalty" | "presencePenalty"

/** Wire names, in the order the header lists them. */
const WIRE: ReadonlyArray<readonly [Param, string]> = [
  ["temperature", "temperature"],
  ["topP", "top_p"],
  ["frequencyPenalty", "frequency_penalty"],
  ["presencePenalty", "presence_penalty"],
]

interface Rule {
  readonly applies: (ref: ModelRef) => boolean
  /** `null`: the model takes no value; a number: the only value it takes (any other is dropped). */
  readonly only?: Readonly<Partial<Record<Param, number | null>>>
  /** The model takes the key or the one it is listed under, not both: the listed one is dropped when the other is set. */
  readonly notWith?: Readonly<Partial<Record<Param, Param>>>
}

/** `claude-opus-4-7`, `claude-sonnet-5.5`, `claude-haiku-5-5-20260101`: family and version. */
const claude = (id: string): { modern: boolean } | undefined => {
  if (/^claude-fable/.test(id)) return { modern: true }
  const match = /^claude-(?:opus|sonnet|haiku)-(\d+)(?:[-.](\d{1,2})(?!\d))?/.exec(id)
  if (!match) return undefined
  const major = Number(match[1])
  const minor = Number(match[2] ?? 0)
  // Opus 4.7 and newer, and every 5.x: temperature and top_p are deprecated, or limited to
  // their defaults while adaptive thinking is on (which is the default).
  return { modern: major > 4 || (major === 4 && minor >= 7) }
}

const gpt = (id: string) => /^gpt-[56]/.test(id)

const RULES: ReadonlyArray<Rule> = [
  // Claude through the Anthropic protocol: 400 "`temperature` is deprecated for this model" /
  // "`temperature` may only be set to 1 when thinking is enabled or in adaptive mode".
  // Probed: anthropic opus-4-7, opus-4-8, opus-5, opus-5-5, sonnet-5, sonnet-5-5, haiku-5-5,
  // fable-5, fable-5-1; opencode-go claude-haiku-5-5. GitHub Copilot's haiku-5.5 took them.
  {
    applies: (ref) => ref.providerID !== "github-copilot" && claude(ref.id)?.modern === true,
    only: { temperature: null, topP: null },
  },
  // Older Claude: 400 "`temperature` and `top_p` cannot both be specified for this model".
  // Probed: anthropic haiku-4-5, sonnet-4-5, sonnet-4-6, opus-4-5, opus-4-6; copilot haiku-4.5.
  { applies: (ref) => claude(ref.id)?.modern === false, notWith: { topP: "temperature" } },
  // GPT-5 and 6 reasoning models: 400 "Unsupported parameter: temperature" (and the other three).
  // Probed: openai gpt-5.5, gpt-5.6-luna, gpt-6.1-sol; opencode-go gpt-5.6-luna, gpt-6-luna.
  { applies: (ref) => gpt(ref.id) && ref.providerID !== "github-copilot", only: { temperature: null, topP: null, frequencyPenalty: null, presencePenalty: null } },
  // Copilot's GPT-5/6 refuse only temperature and top_p (gpt-5-mini, gpt-5.5, gpt-6-luna; penalties passed).
  { applies: (ref) => gpt(ref.id) && ref.providerID === "github-copilot", only: { temperature: null, topP: null } },
  // opencode-go glm-5.3-flash: 400 "only frequency_penalty=0 is supported".
  { applies: (ref) => ref.providerID === "opencode-go" && ref.id === "glm-5.3-flash", only: { frequencyPenalty: 0, presencePenalty: 0 } },
  // opencode-go kimi-k2.7-code: 400 "invalid temperature: only 1 is allowed for this model" (and the other three).
  {
    applies: (ref) => ref.providerID === "opencode-go" && ref.id === "kimi-k2.7-code",
    only: { temperature: 1, topP: 0.95, frequencyPenalty: 0, presencePenalty: 0 },
  },
]

export interface Sampled {
  readonly generation: PlugGeneration
  /** Wire names of the dropped parameters, in header order (`temperature`, `top_p`, `frequency_penalty`, `presence_penalty`). */
  readonly dropped: ReadonlyArray<string>
}

/**
 * The request's generation as the app allows it. Sampling defaults (`apps.<name>.sampling`, #264) fill only the fields the caller
 * left unset. `apps.<name>.maxOutputTokens` (#263) lowers the caller's `maxTokens` or sets it when none is left, and never raises it.
 * Routes apply this before `dropRejected`, so the drop sees the values the model would get.
 */
export function appGeneration(policy: AppPolicy | undefined, generation: PlugGeneration): PlugGeneration {
  const defaults = policy?.sampling
  const cap = policy?.maxOutputTokens
  if (defaults === undefined && cap === undefined) return generation
  const out: { -readonly [K in keyof PlugGeneration]: PlugGeneration[K] } = { ...generation }
  if (defaults)
    for (const key of Object.keys(defaults) as Array<keyof PlugGeneration>) if (out[key] === undefined) out[key] = defaults[key] as never
  if (cap !== undefined) out.maxTokens = out.maxTokens === undefined ? cap : Math.min(out.maxTokens, cap)
  return out
}

/** `generation` without the parameters the model is known to reject, and which ones those were. */
export function dropRejected(ref: ModelRef, generation: PlugGeneration): Sampled {
  const rules = RULES.filter((rule) => rule.applies(ref))
  if (rules.length === 0) return { generation, dropped: [] }
  const out: { -readonly [K in keyof PlugGeneration]: PlugGeneration[K] } = { ...generation }
  const drop = new Set<Param>()
  for (const rule of rules)
    for (const [param, allowed] of Object.entries(rule.only ?? {}) as Array<[Param, number | null]>) {
      const value = generation[param]
      if (value !== undefined && value !== allowed) drop.add(param)
    }
  // `notWith` looks at what survives the rules above.
  for (const rule of rules)
    for (const [param, other] of Object.entries(rule.notWith ?? {}) as Array<[Param, Param]>)
      if (generation[param] !== undefined && !drop.has(param) && generation[other] !== undefined && !drop.has(other)) drop.add(param)
  for (const param of drop) delete out[param]
  return { generation: out, dropped: WIRE.filter(([param]) => drop.has(param)).map(([, wire]) => wire) }
}
