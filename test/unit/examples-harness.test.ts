/**
 * The examples harness's summary schema (examples/_harness/run.schema.json) accepts the golden fixture and rejects
 * a summary without its verdict. run.ts validates every summary against the same schema before it writes it.
 */
import { describe, expect, test } from "bun:test"
import Ajv2020 from "ajv/dist/2020"
import { fileURLToPath } from "node:url"

const harness = (name: string) => fileURLToPath(new URL(`../../examples/_harness/${name}`, import.meta.url))

const ajv = new Ajv2020({ allErrors: true })
// Compiled once: ajv refuses a second compile of the schema's $id.
const validate = Bun.file(harness("run.schema.json"))
  .json()
  .then((schema) => ajv.compile(schema))

describe("examples summary schema", () => {
  test("the golden summary validates against run.schema.json", async () => {
    const check = await validate
    const golden = await Bun.file(harness("golden/summary.json")).json()
    expect(check(golden), JSON.stringify(check.errors)).toBe(true)
  })

  test("a summary without a verdict is rejected", async () => {
    const check = await validate
    const golden = await Bun.file(harness("golden/summary.json")).json()
    const { verdict: _verdict, ...withoutVerdict } = golden
    expect(check(withoutVerdict)).toBe(false)
  })

  test("a scenario status outside pass, fail, gap and n/a is rejected", async () => {
    const check = await validate
    const golden = await Bun.file(harness("golden/summary.json")).json()
    golden.scenarios[0].status = "skipped"
    expect(check(golden)).toBe(false)
  })
})
