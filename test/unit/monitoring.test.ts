import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createMetrics } from "../../src/metrics.js"

const root = join(import.meta.dir, "../..")
const rules = readFileSync(join(root, "monitoring/prometheus-rules.yml"), "utf8")
const dashboardText = readFileSync(join(root, "monitoring/grafana-dashboard.json"), "utf8")

interface Panel {
  readonly id: number
  readonly type: string
  readonly title: string
  readonly datasource?: { readonly uid?: string }
  readonly targets: ReadonlyArray<{ readonly expr: string }>
}
interface Dashboard {
  readonly uid: string
  readonly panels: ReadonlyArray<Panel>
  readonly templating: { readonly list: ReadonlyArray<{ readonly name: string; readonly type: string }> }
}
const dashboard = JSON.parse(dashboardText) as Dashboard

/** Every metric method once, so each family shows the label names it really has. */
async function exposedLabels(): Promise<Map<string, Set<string>>> {
  const metrics = createMetrics()
  metrics.requestStarted()
  metrics.requestFinished({ app: "a", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 5 })
  metrics.tokens("a", { inputTokens: 10, outputTokens: 5, cacheReadTokens: 1, cacheWriteTokens: 1, reasoningTokens: 1 })
  metrics.dropped(["temperature"])
  metrics.fallback("a")
  metrics.breaker("a", "open")
  metrics.usageMissing("a", "stop")
  metrics.settledFromTranscript("a")
  metrics.imageFetch({ outcome: "ok", bytes: 1, ms: 1 })
  metrics.limited("a", "rate")
  metrics.cache("a", "hit")
  metrics.sweep("ok", 1)
  const text = await metrics.render({ generations: 1, pumpRunning: true, guards: 0, startedAt: 1_700_000_000_000 })
  const out = new Map<string, Set<string>>()
  for (const line of text.split("\n")) {
    const type = /^# TYPE (\S+) /.exec(line)
    if (type?.[1]) out.set(type[1], out.get(type[1]) ?? new Set())
    const sample = /^([a-z_]+)(?:\{([^}]*)\})? /.exec(line)
    if (!sample?.[1] || line.startsWith("#")) continue
    const family = sample[1].replace(/_(bucket|sum|count)$/, "")
    const labels = out.get(family) ?? out.get(sample[1]) ?? new Set<string>()
    for (const pair of (sample[2] ?? "").split(",")) if (pair) labels.add(pair.slice(0, pair.indexOf("=")))
    out.set(out.has(family) ? family : sample[1], labels)
  }
  return out
}

/** The `metric{label=...}` selectors and bare metric names in a query or rules text. */
function usedMetrics(text: string): { names: Set<string>; selectors: Array<{ name: string; labels: string[] }> } {
  const names = new Set([...text.matchAll(/\bplugboard_[a-z_]+/g)].map((match) => match[0]))
  const selectors = [...text.matchAll(/\b(plugboard_[a-z_]+)\{([^}]*)\}/g)].map((match) => ({
    name: match[1] ?? "",
    labels: [...(match[2] ?? "").matchAll(/([a-z_]+)\s*(?:=~|!~|!=|=)/g)].map((label) => label[1] ?? ""),
  }))
  return { names, selectors }
}

const queries = dashboard.panels.flatMap((panel) => panel.targets.map((target) => target.expr))
const family = (name: string) => name.replace(/_(bucket|sum|count)$/, "")

describe("monitoring files stay in step with src/metrics.ts", () => {
  test("every metric the rules and the dashboard use is exposed, with the labels they select on", async () => {
    const exposed = await exposedLabels()
    for (const [source, text] of [
      ["rules", rules],
      ["dashboard", queries.join("\n")],
    ] as const) {
      const used = usedMetrics(text)
      for (const name of used.names) expect({ source, name, exposed: exposed.has(family(name)) }).toEqual({ source, name, exposed: true })
      for (const selector of used.selectors)
        for (const label of selector.labels)
          expect({ source, name: selector.name, label, has: exposed.get(family(selector.name))?.has(label) }).toEqual({ source, name: selector.name, label, has: true })
    }
  })

  test("the rules file has recording and alerting rules for the documented cases", () => {
    for (const alert of [
      "PlugboardDown",
      "PlugboardHighErrorRate",
      "PlugboardRateLimited",
      "PlugboardBudgetExhausted",
      "PlugboardCircuitBreakerOpen",
      "PlugboardFallbacksSpiking",
      "PlugboardHighLatency",
    ])
      expect(rules).toContain(`alert: ${alert}`)
    expect(rules).toContain("record: plugboard:requests_5xx:ratio_rate5m")
  })

  test("the dashboard imports: a datasource and an app variable, unique panel ids, every query on the datasource variable", () => {
    expect(dashboard.uid).toBe("plugboard-overview")
    expect(dashboard.templating.list.map((variable) => `${variable.name}:${variable.type}`)).toEqual(["datasource:datasource", "app:query"])
    const ids = dashboard.panels.map((panel) => panel.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const panel of dashboard.panels) expect({ title: panel.title, uid: panel.datasource?.uid }).toEqual({ title: panel.title, uid: "${datasource}" })
    expect(queries.length).toBeGreaterThanOrEqual(dashboard.panels.length)
  })
})
