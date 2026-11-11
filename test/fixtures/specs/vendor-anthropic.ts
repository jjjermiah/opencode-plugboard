#!/usr/bin/env bun
/**
 * Derives test/fixtures/specs/anthropic.json (#107) from the official Anthropic SDK's types, for
 * the conformance test (test/compat/conformance.test.ts). Run by hand when the SDK is bumped; the
 * output is committed, so the tests never touch the network or the compiler:
 *
 *   bun test/fixtures/specs/vendor-anthropic.ts
 *
 * Why the SDK and not a spec: Anthropic publishes no machine-readable Messages spec. The Stainless
 * spec URL that the SDK repos once recorded in `.stats.yml` is gone, and the copies on GitHub and
 * gists are not Anthropic's. The SDK's types are what Anthropic ships, so they are the source. The
 * version is pinned here and must match the installed package (see SDK below).
 *
 * Each `$defs` entry is one named interface, type alias or union of the roots. Every object is a
 * `$ref` (never inline in an `anyOf`), so each union variant is checked on its own by the
 * conformance test's `strict` rule. Optional properties are not `required`; `null` members stay.
 */
import ts from "typescript"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/** The pinned SDK version (package.json: @anthropic-ai/sdk). Generation fails when the installed one differs. */
const SDK = "1.3.0"
const RETRIEVED = "2026-11-01"
const SOURCE = `https://www.npmjs.com/package/@anthropic-ai/sdk/v/${SDK}`

/** The response roots, by the SDK type they name: the Message, the token count, the error body and every stream event. */
const ROOTS: ReadonlyArray<readonly [name: string, module: "messages" | "shared"]> = [
  ["Message", "messages"],
  ["MessageTokensCount", "messages"],
  ["ErrorResponse", "shared"],
  ["RawMessageStreamEvent", "messages"],
  ["RawMessageStartEvent", "messages"],
  ["RawContentBlockStartEvent", "messages"],
  ["RawContentBlockDeltaEvent", "messages"],
  ["RawContentBlockStopEvent", "messages"],
  ["RawMessageDeltaEvent", "messages"],
  ["RawMessageStopEvent", "messages"],
]

const installed = JSON.parse(readFileSync(new URL("../../../node_modules/@anthropic-ai/sdk/package.json", import.meta.url), "utf8")) as { version: string }
if (installed.version !== SDK) throw new Error(`@anthropic-ai/sdk is ${installed.version}, expected ${SDK}: bump SDK here and regenerate`)

type Json = Record<string, unknown>

// The roots as type aliases in a virtual file, so the checker resolves the SDK's types for us.
const rootPath = fileURLToPath(new URL("./anthropic-roots.ts", import.meta.url))
const rootText = [
  'import type * as M from "@anthropic-ai/sdk/resources/messages/messages"',
  'import type * as S from "@anthropic-ai/sdk/resources/shared"',
  ...ROOTS.map(([name, module]) => `export type Root_${name} = ${module === "messages" ? "M" : "S"}.${name}`),
].join("\n")
const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, types: [] }
const host = ts.createCompilerHost(options)
const getSourceFile = host.getSourceFile.bind(host)
host.getSourceFile = (file, ...rest) => (file === rootPath ? ts.createSourceFile(rootPath, rootText, ts.ScriptTarget.ES2022, true) : getSourceFile(file, ...rest))
const program = ts.createProgram({ rootNames: [rootPath], options, host })
const checker = program.getTypeChecker()
const rootFile = program.getSourceFile(rootPath)!
const problems = ts.getPreEmitDiagnostics(program, rootFile).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
if (problems.length > 0) throw new Error(`SDK types did not resolve:\n${problems.join("\n")}`)

const defs: Record<string, Json> = {}
const names = new Map<ts.Type, string>()
const taken = new Set<string>()

const ref = (name: string): Json => ({ $ref: `#/$defs/${name}` })
const isArray = (type: ts.Type): boolean => (type.getSymbol()?.name === "Array" || type.getSymbol()?.name === "ReadonlyArray") && checker.getTypeArguments(type as ts.TypeReference).length === 1

/** Names an object or aliased union once (by its own name, or the property path that reaches it) and returns a `$ref` to it. */
function define(type: ts.Type, hint: string): Json {
  const known = names.get(type)
  if (known) return ref(known)
  const own = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName()
  const base = own && !own.startsWith("__") ? own : hint
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`
  taken.add(name)
  names.set(type, name)
  defs[name] = {}
  defs[name] = build(type, name)
  return ref(name)
}

function build(type: ts.Type, name: string): Json {
  if (type.flags & ts.TypeFlags.Union) return unionOf(type as ts.UnionType, name)
  const properties: Json = {}
  const required: string[] = []
  const declaration = checker.getPropertiesOfType(type)
  for (const property of declaration) {
    const propertyType = checker.getTypeOfSymbolAtLocation(property, rootFile)
    if (checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call).length > 0) continue
    properties[property.getName()] = convert(propertyType, `${name}_${property.getName()}`)
    if ((property.flags & ts.SymbolFlags.Optional) === 0) required.push(property.getName())
  }
  const out: Json = { type: "object" }
  if (Object.keys(properties).length > 0) out.properties = properties
  if (required.length > 0) out.required = required
  const index = checker.getIndexInfosOfType(type).find((info) => info.keyType.flags & ts.TypeFlags.String)
  if (index) out.additionalProperties = convert(index.type, `${name}_value`)
  return out
}

/** A union: all string literals become an enum; the rest are `anyOf` branches, each a `$ref` or a scalar. */
function unionOf(type: ts.UnionType, hint: string): Json {
  const members = type.types.filter((member) => (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) === 0)
  if (members.length > 0 && members.every((member) => member.flags & ts.TypeFlags.StringLiteral))
    return { type: "string", enum: members.map((member) => (member as ts.StringLiteralType).value) }
  const branches: Json[] = []
  const hasTrue = members.some((member) => checker.typeToString(member) === "true")
  const hasFalse = members.some((member) => checker.typeToString(member) === "false")
  for (const member of members) {
    const literal = checker.typeToString(member)
    if (hasTrue && hasFalse && (literal === "true" || literal === "false")) {
      if (literal === "true") branches.push({ type: "boolean" })
      continue
    }
    branches.push(convert(member, hint))
  }
  return branches.length === 1 ? branches[0]! : { anyOf: branches }
}

function convert(type: ts.Type, hint: string): Json {
  const flags = type.flags
  if (flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {}
  if (flags & ts.TypeFlags.Null) return { type: "null" }
  if (flags & ts.TypeFlags.Union) return type.aliasSymbol ? define(type, hint) : unionOf(type as ts.UnionType, hint)
  if (flags & ts.TypeFlags.BooleanLiteral) return { const: checker.typeToString(type) === "true" }
  if (flags & ts.TypeFlags.StringLiteral) return { const: (type as ts.StringLiteralType).value }
  if (flags & ts.TypeFlags.NumberLiteral) return { const: (type as ts.NumberLiteralType).value }
  if (flags & ts.TypeFlags.String) return { type: "string" }
  if (flags & ts.TypeFlags.Number) return { type: "number" }
  if (flags & ts.TypeFlags.Boolean) return { type: "boolean" }
  if (isArray(type)) return { type: "array", items: convert(checker.getTypeArguments(type as ts.TypeReference)[0]!, `${hint}_item`) }
  // `string & {}` (the SDK's open model ids): a string, not an empty object.
  if (flags & ts.TypeFlags.Intersection) {
    const primitive = (type as ts.IntersectionType).types.find((member) => member.flags & (ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean))
    if (primitive) return convert(primitive, hint)
  }
  if (flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) return define(type, hint)
  throw new Error(`unsupported SDK type at ${hint}: ${checker.typeToString(type)}`)
}

const roots: string[] = []
for (const statement of rootFile.statements) {
  if (!ts.isTypeAliasDeclaration(statement) || !statement.name.text.startsWith("Root_")) continue
  const schema = convert(checker.getTypeFromTypeNode(statement.type), statement.name.text.slice("Root_".length))
  const name = (schema.$ref as string | undefined)?.slice("#/$defs/".length)
  if (!name) throw new Error(`root ${statement.name.text} is not a named type`)
  roots.push(name)
}

const out = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $source: SOURCE,
  $retrieved: RETRIEVED,
  roots,
  $defs: defs,
}
await Bun.write(new URL("./anthropic.json", import.meta.url), JSON.stringify(out, null, 1) + "\n")
console.log(`anthropic.json: ${roots.length} roots, ${Object.keys(defs).length} schemas (@anthropic-ai/sdk ${SDK})`)
