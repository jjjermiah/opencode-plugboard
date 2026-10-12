// The `./rpc` entrypoint, at the package root for the same reason as `tui.ts`: a plugin configured
// by local path is resolved as `<directory>/rpc`, without `exports`.
export * from "./src/rpc.ts"
