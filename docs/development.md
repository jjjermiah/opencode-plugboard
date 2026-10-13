# Development

Run plugboard against its own throwaway OpenCode server, never your everyday one. A plugin effect that blocks once froze every prompt in the project that loaded it, and a plugin bug on your main service takes your real sessions down with it. See [architecture.md](architecture.md) for why.

Type check first, on every change:

```sh
bun install
bun run typecheck
```

The `/plugboard` TUI page loads from `dist/tui.js` when the package is installed from npm, and from `tui.ts` (which re-exports it) when it is configured by local path. Run `bun run build:tui` once after a change to `src/tui.tsx`, before you test the TUI page against a local checkout. `bun run typecheck` and `bun test` do not need the build. See [packaging.md](packaging.md) for why the file is compiled.

The type check is also the host-compatibility gate: it fails when the `@opencode/plugin` types change shape. The devDependencies are pinned to the newest host (`@opencode/plugin` 2.0.27 with `effect` 4.0.1). The peer range `>=2.0.26 <2.1` allows 2.0.x patch releases; CI runs the typecheck and tests against 2.0.26 (with `effect` 4.0.0-rc.112) and 2.0.27, and the other releases in the range are not tested.

## Isolated server

Give the dev server its own `HOME` and XDG directories, its own plugboard port, and an empty project to run in. A wrapper keeps that in one place. Save it as `pb-dev` somewhere on your `PATH`:

```sh
#!/usr/bin/env bash
# Run opencode with its own HOME and XDG dirs. Shares nothing with your real OpenCode.
set -eu
D="${PB_DEV_DIR:-$HOME/.cache/plugboard-dev}"
BIN="${OPENCODE_BIN:-$(command -v opencode)}"
mkdir -p "$D/project"
export HOME="$D/home" XDG_CONFIG_HOME="$D/home/.config" XDG_DATA_HOME="$D/home/.local/share" \
       XDG_STATE_HOME="$D/home/.local/state" XDG_CACHE_HOME="$D/home/.cache"
cd "$D/project"
exec "$BIN" "$@"
```

Write the config at `$D/home/.config/opencode/opencode.jsonc` (with the default `PB_DEV_DIR` that is `~/.cache/plugboard-dev/home/.config/opencode/opencode.jsonc`). Point `package` at your checkout and pick a port that is not 4010 if your real setup uses it:

```jsonc
{
  "plugins": [
    {
      "package": "/path/to/opencode-plugboard",
      "options": {
        "listen": { "host": "127.0.0.1", "port": 4110 },
        "keys": { "dev": "dev-key-change-me" },
        "models": ["opencode-go/*"],
        "aliases": { "fast": "opencode-go/glm-5.3-flash" }
      }
    }
  ]
}
```

The isolated home has no provider logins. Set up the providers you want to test there, or pass their keys through the environment, and list them in `models`.

Start it and load the plugin:

```sh
pb-dev serve --service          # leave running in its own terminal
pb-dev api get /api/agent       # warm-up: OpenCode loads no plugin until a client touches it
```

## The pong gate

After every plugin change, before anything else:

```sh
curl -s http://127.0.0.1:4110/v1/chat/completions \
  -H "Authorization: Bearer dev-key-change-me" -H "Content-Type: application/json" \
  -d '{"model": "fast", "messages": [{"role": "user", "content": "reply with exactly: pong"}]}'
```

The reply must contain `pong`. Run it again after a change that could affect reloads, tools or streaming; a plugin that loads but wedges a session looks fine until something prompts. The dev server picks up edits by reloading, and the port can refuse connections for a few seconds while it does. Retry once after 10 seconds before calling it a bug.

If a request hangs, stop the dev server (`pkill -f "serve --service"` also matches your real service, so kill by the PID in `$D/home/.local/state/opencode/service.json` instead), delete `$D` and start again. That costs nothing, which is the point.

## Test knob: the keep-alive interval

`PLUGBOARD_KEEPALIVE_INTERVAL_MS` replaces the keep-alive's 30-minute interval (src/keepalive.ts). Only a positive integer counts; anything else keeps 30 minutes. The unit tests set it, and the dev server can set it to watch the keep-alive children change (one created and one removed per tick) without waiting half an hour. Nothing in production sets it.

## Rules for the dev server

- One person or agent changes the plugin at a time, and only that one uses the dev server. Parallel client runs are fine, edits are not.
- Use a separate key and app name for test traffic (`dev` above), so its history stays apart from real apps.
- Keep model calls tiny. Use an alias for a cheap model.
- Clean up test history with `compat/tools/sessions.py`. It needs to talk to the same isolated server: `PLUGBOARD_OC=pb-dev PLUGBOARD_DATA_ROOT="${PB_DEV_DIR:-$HOME/.cache/plugboard-dev}/home/.local/share/opencode-plugboard" python3 compat/tools/sessions.py list --app dev`.
- The isolated server keeps its history in its own database under `$D/home/.local/share/opencode/`, so deleting `$D` removes it all.
- Client checks live in [`compat/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/compat/README.md). Each runner exits nonzero when a scenario fails. Before a release, fill in [`compat/results/release-candidate.md`](https://github.com/jjjermiah/opencode-plugboard/blob/main/compat/results/release-candidate.md) against the commit you will tag.
