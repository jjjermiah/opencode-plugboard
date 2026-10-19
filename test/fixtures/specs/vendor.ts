#!/usr/bin/env bun
/**
 * Vendors the response schemas that the conformance test (#107, test/compat/conformance.test.ts)
 * validates plugboard's output against. Run by hand when the upstream spec is re-pulled; the
 * output is committed, so the tests never touch the network:
 *
 *   bun test/fixtures/specs/vendor.ts            # fetches the sources below
 *   bun test/fixtures/specs/vendor.ts <dir>      # reads <dir>/openai.yaml and <dir>/gemini.json
 *
 * Each output keeps only the closure of the response roots (every schema they reference, through
 * `$ref`), and records its source URL and the retrieval date in `$source` and `$retrieved`.
 * Terms for each source (MIT for openai.json, unclear for gemini.json): THIRD_PARTY_NOTICES.md.
 */
import { mkdir } from "node:fs/promises"

const RETRIEVED = "2026-10-17"
const OPENAI = { url: "https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml", roots: ["CreateChatCompletionResponse", "CreateChatCompletionStreamResponse", "CreateCompletionResponse", "ListModelsResponse", "Response", "ResponseItemList"] }
const GEMINI = { url: "https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta", roots: ["GenerateContentResponse", "CountTokensResponse"] }

type Json = Record<string, unknown>

/** Every schema reachable from `roots`, by name. `refOf` turns a `$ref` string into a schema name. */
function closure(all: Record<string, unknown>, roots: string[], refOf: (ref: string) => string | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (value === null || typeof value !== "object") return
    const record = value as Json
    if (typeof record.$ref === "string") {
      const name = refOf(record.$ref)
      if (name !== undefined && !(name in out)) {
        if (!(name in all)) throw new Error(`unresolved $ref ${record.$ref}`)
        out[name] = all[name]
        visit(all[name])
      }
    }
    for (const child of Object.values(record)) visit(child)
  }
  for (const root of roots) {
    if (!(root in all)) throw new Error(`missing root schema ${root}`)
    out[root] = all[root]
    visit(all[root])
  }
  return out
}

/** Keys that only document a schema: dropped to keep the vendored file small. */
const DOCUMENTATION = new Set(["description", "title", "example", "examples", "x-oaiMeta", "readOnly", "deprecated", "externalDocs"])

/** Rewrites the references to the output's `$defs`, and turns the discovery doc's `any` into an unconstrained schema. */
function localize(value: unknown, rewrite: (ref: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => localize(item, rewrite))
  if (value === null || typeof value !== "object") return value
  const out: Json = {}
  for (const [key, child] of Object.entries(value as Json)) {
    if (DOCUMENTATION.has(key)) continue
    // The discovery doc names each schema with an `id` string; a property named `id` is an object, so it stays.
    if (key === "id" && typeof child === "string") continue
    if (key === "$ref" && typeof child === "string") out[key] = rewrite(child)
    else if (key === "type" && child === "any") continue
    else out[key] = localize(child, rewrite)
  }
  return out
}

async function source(argument: string | undefined, file: string, url: string): Promise<string> {
  if (argument) return Bun.file(`${argument}/${file}`).text()
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.text()
}

const dir = Bun.argv[2]
const out = new URL("./", import.meta.url)
await mkdir(out, { recursive: true })

// OpenAI: OpenAPI 3.1 (JSON Schema 2020-12); the components are referenced as #/components/schemas/<name>.
const openaiSpec = Bun.YAML.parse(await source(dir, "openai.yaml", OPENAI.url)) as { components: { schemas: Record<string, unknown> } }
const openaiDefs = closure(openaiSpec.components.schemas, OPENAI.roots, (ref) => (ref.startsWith("#/components/schemas/") ? ref.slice("#/components/schemas/".length) : undefined))
const openaiOut = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $source: OPENAI.url,
  $retrieved: RETRIEVED,
  roots: OPENAI.roots,
  $defs: localize(openaiDefs, (ref) => `#/$defs/${ref.slice("#/components/schemas/".length)}`),
}
await Bun.write(new URL("openai.json", out), JSON.stringify(openaiOut, null, 1) + "\n")

// Gemini: the discovery document; its schemas are referenced by bare name.
const geminiSpec = JSON.parse(await source(dir, "gemini.json", GEMINI.url)) as { schemas: Record<string, unknown> }
const geminiDefs = closure(geminiSpec.schemas, GEMINI.roots, (ref) => (ref in geminiSpec.schemas ? ref : undefined))
const geminiOut = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $source: GEMINI.url,
  $retrieved: RETRIEVED,
  roots: GEMINI.roots,
  $defs: localize(geminiDefs, (ref) => `#/$defs/${ref}`),
}
await Bun.write(new URL("gemini.json", out), JSON.stringify(geminiOut, null, 1) + "\n")

console.log(`openai.json: ${Object.keys(openaiDefs).length} schemas; gemini.json: ${Object.keys(geminiDefs).length} schemas`)
