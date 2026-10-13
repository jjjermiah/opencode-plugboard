/**
 * The plugboard package version, from `package.json` at the package root (#347). Read once, when this module loads.
 * `src/` sits one level below the root in a checkout and in an npm install (npm always ships package.json), so `../` is the same file in both.
 */
import { readFileSync } from "node:fs"

export const PACKAGE_VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version
