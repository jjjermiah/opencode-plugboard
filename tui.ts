// The `./tui` entrypoint. OpenCode resolves a package's TUI entry through `exports["./tui"]`, but a
// plugin configured by local path is resolved as `<directory>/tui` with no `exports` lookup
// (packages/plugin/src/host.ts in OpenCode 2.0.26), so the entry lives at the package root.
export { default } from "./src/tui.tsx"
