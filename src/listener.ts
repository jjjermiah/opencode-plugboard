/**
 * Forwarding façade: the process-wide HTTP listener now lives in the process runtime
 * (src/runtime.ts). Import from there; this module exists only so existing imports keep working.
 */

export { GRACE_MS, onListenerClose, registerGeneration, type Handler, type Registration } from "./runtime.js"
