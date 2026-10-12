# Usage page in the OpenCode TUI

Plugboard adds a `/plugboard` page to OpenCode's terminal UI. It shows the per-app usage statistics of the server the TUI is connected to, the same numbers as [Usage statistics](configuration.md#usage-statistics) and `GET /v1/usage`.

## Opening it

- Type `/plugboard` in the prompt, or pick **Plugboard usage** from the command palette.
- It needs nothing extra. OpenCode loads the TUI entry (`opencode-plugboard/tui`) for every server that runs plugboard, because the package exports it beside the server entry.

## What it shows

- A header with the range in UTC days and the keys.
- A totals line: requests, tokens, estimated cost, errors, cache hit rate, fallbacks, 429 refusals and p95 latency.
- One row per app, most expensive first, with a bar for its share of the cost (its share of the requests when nothing was priced).
- The ten most expensive models, summed over the apps.

Latency percentiles are estimates: they are the upper bound of the histogram bucket that holds the percentile.

## Keys

| Key | Action |
|---|---|
| `t` | Today (one UTC day) |
| `w` | The last 7 days |
| `m` | The last 30 days (the default) |
| `q` | The last 90 days |
| `r` | Reload |
| `esc` | Back to the previous screen |

## When it cannot load

If the server has no plugboard, or plugboard runs with `usage` disabled, the page shows a message that says so, and a toast appears. The rest of the TUI keeps working.

## How it reads the data

The page calls the `opencode-plugboard.usage` RPC (`src/rpc.ts`) through OpenCode's client, so it talks to the server over OpenCode's own authenticated API. It does not call `GET /v1/usage` and does not need the admin key. The RPC returns every app, which is what the page needs.

The page code is `src/tui.tsx` (Solid and OpenTUI, not in the server entry). Its pure helpers (ranges, rows, formats) are in `src/tui-format.ts` and are unit tested.
