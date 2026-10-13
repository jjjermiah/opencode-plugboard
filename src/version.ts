/**
 * The plugboard package version, from `package.json` at the package root (#347). Read once, when this module loads.
 * `src/` sits one level below the root in a checkout and in an npm install (npm always ships package.json), so `../` is the same file in both.
 * A failed read leaves the version undefined rather than failing the plugin's load: `/plugboard/status` then omits the field.
 */
import { readFileSync } from "node:fs"

/** The package.json version at `url`, or undefined when the file cannot be read or has no string `version`. */
export function readPackageVersion(url: URL): string | undefined {
  try {
    const version = (JSON.parse(readFileSync(url, "utf8")) as { version?: unknown }).version
    return typeof version === "string" && version !== "" ? version : undefined
  } catch {
    return undefined
  }
}

export const PACKAGE_VERSION: string | undefined = readPackageVersion(new URL("../package.json", import.meta.url))

/** Placeholders a host reports when it has no real version (an unbundled or dev build). They are not versions. */
const PLACEHOLDER_HOST_VERSIONS: ReadonlySet<string> = new Set(["unknown", "local"])

/** The host OpenCode version from the plugin context, or undefined when it is absent or a placeholder (#347). */
export function hostVersion(value: string | undefined): string | undefined {
  if (value === undefined || value === "" || PLACEHOLDER_HOST_VERSIONS.has(value)) return undefined
  return value
}
