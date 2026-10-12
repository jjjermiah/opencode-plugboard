/**
 * The usage dashboard page (`GET /dashboard`, #141): static HTML, its headers and the routes that
 * serve it. The page holds no data. It asks for a key, then reads `GET /v1/usage` from the same
 * origin with that key (the data never reaches the page's HTML). No inline script or style: the
 * script and stylesheets are plugboard's own files under `/dashboard/`, served by `src/dashboard/assets.ts`.
 */

/** Scripts and styles from this origin only; nothing else may load, frame or submit. */
export const DASHBOARD_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/** Headers of every dashboard response; the assets get them too. */
export const DASHBOARD_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": DASHBOARD_CSP,
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
}

/** Routes of the dashboard: the page and its four files. Served only when option `usage` is on. */
export const DASHBOARD_ROUTES: ReadonlySet<string> = new Set([
  "GET /dashboard",
  "GET /dashboard/app.js",
  "GET /dashboard/app.css",
  "GET /dashboard/uplot.js",
  "GET /dashboard/uplot.css",
])

export const DASHBOARD_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>plugboard usage</title>
<link rel="stylesheet" href="/dashboard/uplot.css">
<link rel="stylesheet" href="/dashboard/app.css">
<script src="/dashboard/uplot.js" defer></script>
<script src="/dashboard/app.js" defer></script>
</head>
<body>
<header class="top">
<h1>plugboard usage</h1>
<p class="muted">Requests, tokens and estimated cost per app, per UTC day. Cost uses the catalog's list prices.</p>
</header>
<main>
<section id="signin" class="card" hidden>
<form id="key-form">
<label for="key">API key</label>
<div class="row">
<input id="key" name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">
<button type="submit" class="primary">Show usage</button>
</div>
<p class="muted">The admin key shows every app. An app key shows only its own. The key is kept in this tab's session storage and sent only to this server.</p>
</form>
<p id="auth-error" class="error" role="alert" hidden></p>
</section>
<section id="panel" hidden>
<div class="toolbar">
<div class="ranges" role="group" aria-label="Range">
<button type="button" data-days="1">Today</button>
<button type="button" data-days="7">7 days</button>
<button type="button" data-days="30">30 days</button>
<button type="button" data-days="90">90 days</button>
</div>
<div class="row">
<button type="button" id="refresh">Refresh</button>
<button type="button" id="sign-out">Sign out</button>
</div>
</div>
<p id="status" class="muted" aria-live="polite"></p>
<h2>Totals</h2>
<div id="totals" class="cards"></div>
<h2>Apps</h2>
<div class="scroll"><table id="apps"></table></div>
<h2>Requests per day</h2>
<div id="chart-requests" class="chart"></div>
<h2>Estimated cost per day (USD)</h2>
<div id="chart-cost" class="chart"></div>
<h2>Tokens per day</h2>
<div id="chart-tokens" class="chart"></div>
<h2>Models</h2>
<p id="models-note" class="muted"></p>
<div class="scroll"><table id="models"></table></div>
</section>
</main>
</body>
</html>
`
