// The `./tui` entrypoint for a plugin configured by local path. OpenCode resolves that as
// `<directory>/tui` with no `exports` lookup (packages/plugin/src/host.ts in OpenCode 2.0.26), so the
// entry lives at the package root. It re-exports the compiled file (`bun run build:tui`), not
// src/tui.tsx: a local path under node_modules is never Solid-compiled (see build-tui.ts).
export { default } from "./dist/tui.js"
