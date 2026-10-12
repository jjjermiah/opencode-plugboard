/** #286 `imageProblem`: a `data:` image URL is usable by a provider, or it is refused with a message. */
import { describe, expect, test } from "bun:test"
import { imageProblem, pdfProblem } from "../../src/image.js"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const JPEG = "/9j/4AAQSkZJRgABAQ=="
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1").toString("base64")
const WEBP = Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1").toString("base64")

describe("#286 imageProblem: a data: image URL must be a real image", () => {
  test.each([
    ["png", `data:image/png;base64,${PNG}`],
    ["jpeg", `data:image/jpeg;base64,${JPEG}`],
    ["gif", `data:image/gif;base64,${GIF}`],
    ["webp", `data:image/webp;base64,${WEBP}`],
    ["a media type with parameters", `data:image/png;charset=binary;base64,${PNG}`],
    ["an unpadded base64 string", `data:image/png;base64,${PNG.replace(/=+$/, "")}`],
  ])("%s is accepted", (_name, url) => {
    expect(imageProblem(url)).toBeUndefined()
  })

  test.each([
    ["a text media type", `data:text/html;base64,PGgxPng=`, "image/* media type"],
    ["no media type", `data:;base64,${PNG}`, "image/* media type"],
    ["no base64 marker", `data:image/png,${PNG}`, "must be base64 encoded"],
    ["no comma", `data:image/png;base64`, "must be base64 encoded"],
    ["an empty payload", `data:image/png;base64,`, "has no data"],
    ["characters outside base64", `data:image/png;base64,${PNG.slice(0, 20)}!${PNG.slice(21)}`, "not valid base64"],
    ["a length that cannot be base64", `data:image/png;base64,${PNG.slice(0, 5)}`, "not valid base64"],
    ["bytes with no image signature", `data:image/png;base64,AAAA`, "not a PNG, JPEG, GIF or WebP image"],
    ["text bytes labelled as an image", `data:image/png;base64,${Buffer.from("hello world").toString("base64")}`, "not a PNG, JPEG, GIF or WebP image"],
  ])("%s is refused", (_name, url, message) => {
    expect(imageProblem(url)).toContain(message)
  })

  test("#288 pdfProblem: a PDF data URL with a %PDF signature is accepted; anything else is refused", () => {
    expect(pdfProblem("data:application/pdf;base64,JVBERi0xLjQK")).toBeUndefined()
    expect(pdfProblem("JVBERi0xLjQK")).toContain("must be a PDF data URL")
    expect(pdfProblem("data:application/octet-stream;base64,JVBERi0xLjQK")).toContain("must be a PDF data URL")
    expect(pdfProblem("data:application/pdf;base64,AAAA")).toContain("not a PDF")
    expect(pdfProblem("data:application/pdf;base64,")).toContain("not valid base64")
  })

  test("a remote or non-data URL is not checked here", () => {
    expect(imageProblem("https://x.test/a.png")).toBeUndefined()
    expect(imageProblem("file:///etc/passwd")).toBeUndefined()
  })
})
