/** The one discriminator for `PlugError` values returned in place of a result. */

import type { PlugError } from "./contract.js"

export const isPlugError = (value: unknown): value is PlugError =>
  typeof value === "object" && value !== null && "status" in value && "type" in value && "message" in value
