/**
 * Model-caller: collect one OpenCode session turn into an OpenAI-shaped step result.
 *
 * The turn is stopped from inside the model loop (see `seeds.ts`), so the events of
 * interest are: text deltas/endings, the parsed tool call, and one terminal step
 * event carrying finish reason + tokens.
 */

export interface CollectedToolCall {
  readonly id: string
  readonly name: string
  readonly input: unknown
  readonly executed: boolean
}

export interface CollectedUsage {
  readonly input?: number
  readonly output?: number
  readonly reasoning?: number
  readonly cache?: { readonly read?: number; readonly write?: number }
}

export interface CollectedStep {
  readonly text: string
  readonly toolCalls: ReadonlyArray<CollectedToolCall>
  readonly finish?: string
  readonly rawFinish?: string
  readonly tokens?: CollectedUsage
  readonly cost?: number
  readonly stepError?: unknown
}

/**
 * Single-use sink for the events of one adapter session. `push` is called from the
 * plugin's event-stream fiber; `done` resolves on the terminal step event.
 */
export class StepCollector {
  readonly sessionID: string
  private readonly textParts = new Map<number, string>()
  private readonly toolNames = new Map<string, string>()
  private readonly calls = new Map<string, CollectedToolCall>()
  private readonly settled: Promise<void>
  private settle!: () => void
  /** Resolves when the whole execution (all steps) ended: succeeded, failed or interrupted. */
  readonly executionEnded: Promise<string>
  private endExecution!: (kind: string) => void
  /** Number of model steps that started. */
  steps = 0
  /** Number of tool calls seen so far. */
  get toolCalls(): number {
    return this.calls.size
  }
  private finish?: string
  private rawFinish?: string
  private tokens?: CollectedUsage
  private cost?: number
  private stepError?: unknown

  constructor(sessionID: string) {
    this.sessionID = sessionID
    this.settled = new Promise<void>((resolve) => {
      this.settle = resolve
    })
    this.executionEnded = new Promise<string>((resolve) => {
      this.endExecution = resolve
    })
  }

  get done(): Promise<void> {
    return this.settled
  }

  /** Spike diagnostics: every event seen for this session, with ms since the collector was created. */
  readonly trace: Array<{ t: number; type: string; data?: unknown }> = []
  private readonly started = Date.now()

  push(event: Record<string, any>): void {
    this.trace.push({ t: Date.now() - this.started, type: String(event.type), data: event.delta ?? event.error })
    switch (event.type) {
      case "session.step.started":
        this.steps++
        return
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        this.endExecution(String(event.type))
        return
      case "session.text.delta":
        this.textParts.set(event.ordinal, (this.textParts.get(event.ordinal) ?? "") + String(event.delta ?? ""))
        return
      case "session.text.ended":
        this.textParts.set(event.ordinal, String(event.text ?? ""))
        return
      case "session.tool.input.started":
        this.toolNames.set(String(event.id), String(event.name ?? ""))
        return
      case "session.tool.called":
        this.calls.set(String(event.id), {
          id: String(event.id),
          name: this.toolNames.get(String(event.id)) ?? "",
          input: event.input,
          executed: event.executed === true,
        })
        return
      case "session.usage.updated":
        this.tokens ??= event.tokens as CollectedUsage
        return
      case "session.step.ended":
        this.finish = event.finish
        this.rawFinish = event.rawFinish
        this.tokens = (event.tokens as CollectedUsage) ?? this.tokens
        this.cost = event.cost
        this.settle()
        return
      case "session.step.failed":
        this.finish = event.finish
        this.rawFinish = event.rawFinish
        this.tokens = (event.tokens as CollectedUsage) ?? this.tokens
        this.cost = event.cost
        this.stepError = event.error
        this.settle()
        return
      default:
        return
    }
  }

  result(): CollectedStep {
    const text = [...this.textParts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value)
      .join("")
    return {
      text,
      toolCalls: [...this.calls.values()],
      finish: this.finish,
      rawFinish: this.rawFinish,
      tokens: this.tokens,
      cost: this.cost,
      // The adapter itself interrupts the turn once tool calls are captured; that abort is expected.
      stepError: this.calls.size > 0 && (this.stepError as { type?: string } | undefined)?.type === "aborted" ? undefined : this.stepError,
    }
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
