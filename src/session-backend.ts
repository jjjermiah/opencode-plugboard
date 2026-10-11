/** Forwarding module; the implementation lives under `./session/`. */
export { createSessionCaller } from "./session/caller.js"
export type { SessionCallerDeps } from "./session/caller.js"
export { applyContext } from "./session/context.js"
export { dataRoot, isInsideDataRoot, renderTranscript } from "./session/history.js"
export type { SessionPort } from "./session/host.js"
