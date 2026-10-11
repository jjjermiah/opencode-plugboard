/** Compatibility adapter: `index.ts` still reads `deps.parseOptions`. Removed once it imports `config.ts` directly. */

import { parseOptions } from "./config.js"
import type { RouteDeps } from "./server.js"

export const deps: RouteDeps = { parseOptions }
