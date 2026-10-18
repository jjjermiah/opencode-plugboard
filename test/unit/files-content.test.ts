/**
 * What a file is, from its bytes (src/files/content.ts): the declared type and the name only decide whether text is acceptable.
 */
import { describe, expect, test } from "bun:test"
import { MAX_TEXT_BYTES, baseType, detectFile, kindOf } from "../../src/files/content.js"

const hex = (value: string) => Buffer.from(value, "hex")
const PNG = hex("89504e470d0a1a0a0000000d49484452")
const JPEG = hex("ffd8ffe000104a464946")
const GIF = Buffer.from("GIF89a\u0001\u0000")
const WEBP = Buffer.concat([Buffer.from("RIFF"), hex("24000000"), Buffer.from("WEBPVP8 ")])
const PDF = Buffer.from("%PDF-1.7\n")

describe("images and PDF are told by their bytes", () => {
  test.each([
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["GIF", GIF, "image/gif"],
    ["WebP", WEBP, "image/webp"],
    ["PDF", PDF, "application/pdf"],
  ])("%s, whatever it is called or declared", (_name, bytes, mime) => {
    expect(detectFile(bytes, undefined, undefined)).toEqual({ mime })
    expect(detectFile(bytes, "text/plain", "notes.txt")).toEqual({ mime })
    expect(detectFile(bytes, "application/octet-stream", "blob")).toEqual({ mime })
  })

  test("a RIFF file that is not WebP is not an image", () => {
    const wav = Buffer.concat([Buffer.from("RIFF"), hex("24000000"), Buffer.from("WAVEfmt ")])
    expect(detectFile(wav, "image/webp", "a.webp")).toMatchObject({ problem: expect.stringContaining("Unsupported file type") })
  })
})

describe("text", () => {
  test("is accepted with a declared text type, whatever the name", () => {
    expect(detectFile(Buffer.from("hello"), "text/plain; charset=utf-8", "x.bin")).toEqual({ mime: "text/plain" })
    expect(detectFile(Buffer.from("a,b"), "text/csv", undefined)).toEqual({ mime: "text/csv" })
    expect(detectFile(Buffer.from("héllo ✓"), "TEXT/Markdown", "x")).toEqual({ mime: "text/markdown" })
  })

  test("with no usable declared type, a text extension decides", () => {
    expect(detectFile(Buffer.from("a: 1"), undefined, "conf.YAML")).toEqual({ mime: "text/yaml" })
    expect(detectFile(Buffer.from("a: 1"), "application/octet-stream", "notes.md")).toEqual({ mime: "text/markdown" })
    expect(detectFile(Buffer.from("a: 1"), "not a type", "notes.txt")).toEqual({ mime: "text/plain" })
    expect(detectFile(Buffer.from("hello"), "application/octet-stream", "blob")).toMatchObject({ problem: expect.any(String) })
    expect(detectFile(Buffer.from("hello"), undefined, "noextension")).toMatchObject({ problem: expect.any(String) })
  })

  test("JSON must parse, and is stored as application/json", () => {
    expect(detectFile(Buffer.from('{"a":[1,2]}'), "application/json", "a.json")).toEqual({ mime: "application/json" })
    expect(detectFile(Buffer.from("{nope"), "application/json", "a.json")).toEqual({ problem: "The file is not valid JSON" })
    expect(detectFile(Buffer.from('{"a":1}'), undefined, "a.json")).toEqual({ mime: "application/json" })
  })

  test("invalid UTF-8, NUL bytes, an empty file and an oversize text file are refused with their reason", () => {
    expect(detectFile(Buffer.from([0xff, 0xfe, 0x41]), "text/plain", "a.txt")).toEqual({ problem: "The file is not valid UTF-8 text" })
    expect(detectFile(Buffer.from("a\u0000b"), "text/plain", "a.txt")).toMatchObject({ problem: expect.stringContaining("NUL") })
    expect(detectFile(Buffer.alloc(0), "text/plain", "a.txt")).toEqual({ problem: "The file is empty" })
    expect(detectFile(Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61), "text/plain", "a.txt")).toMatchObject({ problem: expect.stringContaining("4 MiB") })
    expect(detectFile(Buffer.alloc(MAX_TEXT_BYTES, 0x61), "text/plain", "a.txt")).toEqual({ mime: "text/plain" })
  })
})

describe("everything else is refused", () => {
  test("a declared image or PDF whose bytes are neither, an executable, a zip and a misdeclared binary name the accepted kinds", () => {
    for (const [bytes, declared, name] of [
      [Buffer.from("not an image"), "image/png", "a.png"],
      [Buffer.from("not a pdf"), "application/pdf", "a.pdf"],
      [Buffer.from("MZ\u0090\u0000\u0003"), "application/x-msdownload", "a.exe"],
      [Buffer.from("PK\u0003\u0004"), "application/zip", "a.zip"],
      [Buffer.from("plain"), "application/xml-binary", "a.bin"],
    ] as const)
      expect(detectFile(bytes, declared, name)).toMatchObject({ problem: expect.stringContaining("PNG, JPEG, GIF and WebP images, PDF files, and text files") })
  })
})

describe("helpers", () => {
  test("baseType drops parameters, lowercases, and rejects a malformed type", () => {
    expect(baseType("Text/Plain; charset=UTF-8")).toBe("text/plain")
    expect(baseType("nonsense")).toBeUndefined()
    expect(baseType("")).toBeUndefined()
    expect(baseType(undefined)).toBeUndefined()
  })

  test("kindOf", () => {
    expect([kindOf("image/png"), kindOf("application/pdf"), kindOf("text/plain"), kindOf("application/json")]).toEqual(["image", "pdf", "text", "text"])
  })
})
