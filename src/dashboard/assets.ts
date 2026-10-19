/**
 * Serves the usage dashboard (`src/dashboard/page.ts`): the page, the page's own script and
 * stylesheet, and uPlot's browser build and stylesheet from its npm package (all under `/plugboard/dashboard/`). Files are read on the
 * first request and kept in memory. Setup does no filesystem work (I3). The bytes never change
 * while plugboard runs, so the ETag is their hash and a revalidation answers 304.
 */
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { sendText } from "../discovery.js"
import { DASHBOARD_HEADERS, DASHBOARD_PAGE } from "./page.js"

const PAGE_PREFIX = "GET /plugboard/dashboard/"
const here = dirname(fileURLToPath(import.meta.url))
const resolveFrom = createRequire(import.meta.url)

interface AssetFile {
  readonly path: () => string
  readonly contentType: string
}

/** The asset named by the last segment of `/plugboard/dashboard/<name>`. */
const ASSETS: Readonly<Record<string, AssetFile>> = {
  "app.js": { path: () => join(here, "app.js"), contentType: "text/javascript; charset=utf-8" },
  "app.css": { path: () => join(here, "app.css"), contentType: "text/css; charset=utf-8" },
  "uplot.js": { path: () => resolveFrom.resolve("uplot/dist/uPlot.iife.min.js"), contentType: "text/javascript; charset=utf-8" },
  "uplot.css": { path: () => resolveFrom.resolve("uplot/dist/uPlot.min.css"), contentType: "text/css; charset=utf-8" },
}

interface Asset {
  readonly body: string
  readonly contentType: string
  readonly etag: string
}

const loaded = new Map<string, Promise<Asset>>()

async function load(name: string): Promise<Asset> {
  const file = Object.hasOwn(ASSETS, name) ? ASSETS[name] : undefined
  if (!file) throw new Error(`no dashboard asset ${name}`)
  const body = await readFile(file.path(), "utf8")
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 32)
  return { body, contentType: file.contentType, etag: `"${digest}"` }
}

/** The asset's bytes, read once per process. A failed read is not kept, so the next request tries again. */
function asset(name: string): Promise<Asset> {
  let pending = loaded.get(name)
  if (!pending) {
    pending = load(name)
    loaded.set(name, pending)
    pending.catch(() => loaded.delete(name))
  }
  return pending
}

/** Answers one dashboard route (`DASHBOARD_ROUTES`, already matched by the caller). */
export async function serveDashboard(request: IncomingMessage, response: ServerResponse, route: string): Promise<void> {
  if (route === "GET /plugboard/dashboard") return sendText(response, 200, "text/html; charset=utf-8", DASHBOARD_PAGE, DASHBOARD_HEADERS)
  const found = await asset(route.slice(PAGE_PREFIX.length))
  // Assets revalidate on every use: a plugboard upgrade changes them, and the ETag makes that check free.
  const headers = { ...DASHBOARD_HEADERS, "cache-control": "no-cache", etag: found.etag }
  if (request.headers["if-none-match"] === found.etag) {
    if (!response.headersSent && !response.destroyed) response.writeHead(304, headers)
    response.end()
    return
  }
  return sendText(response, 200, found.contentType, found.body, headers)
}
