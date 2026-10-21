/** @jsxImportSource @opentui/solid */
/**
 * The `/plugboard` usage page in OpenCode's terminal UI (package entry `./tui`). OpenCode loads it
 * for every server that runs plugboard with the TUI feature: it reads the usage report over the
 * server's own RPC (`context.client.rpc(UsageRpc).get`, src/rpc.ts), so it sees every app there.
 * Nothing is served over HTTP, and nothing here runs on the server.
 *
 * Page keys: t, w, m, q pick the range (today, 7, 30, 90 UTC days); r reloads; esc goes back.
 * Setup only registers the page and the command (no awaits). Shaping and formats: src/tui-format.ts.
 */

import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { createResource, createSignal, For, Show } from "solid-js"
import { UsageRpc } from "./rpc.js"
import type { UsageReport } from "./usage.js"
import {
  APP_COLUMNS,
  appRows,
  appValues,
  barCells,
  formatLine,
  MODEL_COLUMNS,
  modelRows,
  modelValues,
  presetRange,
  RANGE_PRESETS,
  TAG_COLUMNS,
  tagRows,
  tagValues,
  totalItems,
  unavailableMessage,
  type RangePreset,
} from "./tui-format.js"

type Theme = Plugin.Context["theme"]

interface Query {
  readonly preset: RangePreset
  /** Bumped by `r`; only here so that a reload is a new query. */
  readonly reload: number
}

const PRESET_LABEL = (preset: RangePreset) => RANGE_PRESETS.find((item) => item.preset === preset)?.label ?? preset

function UsagePage(props: { context: Plugin.Context; onClose: () => void }) {
  const theme = props.context.theme
  const [query, setQuery] = createSignal<Query>({ preset: "month", reload: 0 })
  const [report] = createResource(query, async (current) => {
    const range = presetRange(current.preset, Date.now())
    try {
      return (await props.context.client.rpc(UsageRpc).get({ from: range.from, to: range.to })) as UsageReport
    } catch (error) {
      props.context.ui.toast.show({ variant: "error", title: "Plugboard", message: unavailableMessage(error) })
      throw error
    }
  })

  props.context.keymap.layer(() => ({
    commands: [
      { bind: "escape", title: "back", run: props.onClose },
      ...RANGE_PRESETS.map((item) => ({
        bind: item.key,
        title: `range ${item.label}`,
        run: () => setQuery((current) => ({ preset: item.preset, reload: current.reload })),
      })),
      { bind: "r", title: "refresh", run: () => setQuery((current) => ({ ...current, reload: current.reload + 1 })) },
    ],
  }))

  return (
    <box width="100%" height="100%" backgroundColor={theme.background.base}>
      <scrollbox flexGrow={1}>
        <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            Plugboard usage
          </text>
          <text fg={theme.text.muted}>
            {report() ? `${report()!.from} to ${report()!.to} (UTC)` : PRESET_LABEL(query().preset)}
            {" · "}t today · w 7 days · m 30 days · q 90 days · r refresh · esc back
          </text>
          <Show when={!report.error} fallback={<text fg={theme.text.feedback.error.base}>{unavailableMessage(report.error)}</text>}>
            <Show when={report()} fallback={<text fg={theme.text.muted}>Loading usage…</text>}>
              <UsageBody report={report()!} theme={theme} />
            </Show>
          </Show>
        </box>
      </scrollbox>
    </box>
  )
}

function UsageBody(props: { report: UsageReport; theme: Theme }) {
  const apps = () => appRows(props.report)
  const models = () => modelRows(props.report, 10)
  const tags = () => tagRows(props.report, 10)
  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" flexWrap="wrap" gap={2}>
        <For each={totalItems(props.report.totals)}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text fg={props.theme.text.muted}>{item.label}</text>
              <text fg={props.theme.text.base} attributes={TextAttributes.BOLD}>
                {item.value}
              </text>
            </box>
          )}
        </For>
      </box>
      <text fg={props.theme.text.muted} attributes={TextAttributes.BOLD}>
        Apps
      </text>
      <Show when={apps().length > 0} fallback={<text fg={props.theme.text.muted}>No requests in this range.</text>}>
        <text fg={props.theme.text.muted}>
          {formatLine(
            APP_COLUMNS.map((column) => column.title),
            APP_COLUMNS,
          )}
        </text>
        <For each={apps()}>
          {(row) => (
            <box flexDirection="row">
              <text fg={props.theme.text.base}>{formatLine(appValues(row), APP_COLUMNS)}</text>
              <text fg={props.theme.categorical[0][200]}>{`  ${barCells(row.share, 24)}`}</text>
            </box>
          )}
        </For>
      </Show>
      <text fg={props.theme.text.muted} attributes={TextAttributes.BOLD}>
        Models
      </text>
      <Show when={models().length > 0} fallback={<text fg={props.theme.text.muted}>No model calls in this range.</text>}>
        <text fg={props.theme.text.muted}>
          {formatLine(
            MODEL_COLUMNS.map((column) => column.title),
            MODEL_COLUMNS,
          )}
        </text>
        <For each={models()}>{(row) => <text fg={props.theme.text.base}>{formatLine(modelValues(row), MODEL_COLUMNS)}</text>}</For>
      </Show>
      <Show when={tags().length > 0}>
        <text fg={props.theme.text.muted} attributes={TextAttributes.BOLD}>
          Tags
        </text>
        <text fg={props.theme.text.muted}>
          {formatLine(
            TAG_COLUMNS.map((column) => column.title),
            TAG_COLUMNS,
          )}
        </text>
        <For each={tags()}>{(row) => <text fg={props.theme.text.base}>{formatLine(tagValues(row), TAG_COLUMNS)}</text>}</For>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-plugboard.tui",
  setup(context) {
    const [previous, setPrevious] = createSignal({ ...context.ui.router.current() })
    context.ui.router.register({
      name: "plugboard.usage",
      render: () => <UsagePage context={context} onClose={() => context.ui.router.navigate(previous())} />,
    })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "plugboard.usage.open",
          title: "Plugboard usage",
          group: "Plugboard",
          slash: { name: "plugboard" },
          palette: true,
          run() {
            const current = context.ui.router.current()
            if (current.type === "plugin" && current.name === "plugboard.usage") return
            // The router exposes a mutable store; keep the route before navigating.
            setPrevious({ ...current })
            context.ui.dialog.clear()
            context.ui.router.navigate({ type: "plugin", name: "plugboard.usage" })
          },
        },
      ],
    }))
  },
})
