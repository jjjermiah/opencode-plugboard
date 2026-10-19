/**
 * The usage dashboard page (`GET /plugboard/dashboard`, #141): static HTML, its headers and the routes that
 * serve it. The page holds no data. It asks for a key, then reads `GET /plugboard/usage` from the same
 * origin with that key (the data never reaches the page's HTML). No inline script or style: the
 * script and stylesheets are plugboard's own files under `/plugboard/dashboard/`, served by `src/dashboard/assets.ts`.
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
  "GET /plugboard/dashboard",
  "GET /plugboard/dashboard/app.js",
  "GET /plugboard/dashboard/app.css",
  "GET /plugboard/dashboard/uplot.js",
  "GET /plugboard/dashboard/uplot.css",
])

export const DASHBOARD_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>plugboard dashboard</title>
<link rel="stylesheet" href="/plugboard/dashboard/uplot.css">
<link rel="stylesheet" href="/plugboard/dashboard/app.css">
<script src="/plugboard/dashboard/uplot.js" defer></script>
<script src="/plugboard/dashboard/app.js" defer></script>
</head>
<body>
<header class="top">
<h1 class="brand">plugboard</h1>
<p class="muted">Usage per app and model, and the models each key can call. Days are UTC. Cost uses the catalog's list prices.</p>
</header>
<main>
<noscript><p class="card error">The dashboard needs JavaScript.</p></noscript>
<section id="signin" class="card" hidden>
<form id="key-form">
<label for="key">API key</label>
<div class="row">
<input id="key" name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">
<button type="submit" class="primary">Open dashboard</button>
</div>
<p class="muted">The admin key shows usage for every app. An app key shows its own usage and the models it can call. The key is kept in this tab's session storage and sent only to this server.</p>
</form>
<p id="auth-error" class="error" role="alert" hidden></p>
</section>
<section id="panel" hidden>
<div class="bar-top">
<div class="tabs" role="tablist" aria-label="Views">
<button type="button" role="tab" id="tab-usage" data-tab="usage" aria-controls="view-usage" aria-selected="true">Usage</button>
<button type="button" role="tab" id="tab-models" data-tab="models" aria-controls="view-models" aria-selected="false">Models</button>
</div>
<div class="row">
<button type="button" id="refresh">Refresh</button>
<button type="button" id="sign-out">Sign out</button>
</div>
</div>
<div id="view-usage" role="tabpanel" aria-labelledby="tab-usage">
<div class="ranges" id="ranges" role="group" aria-label="Range">
<button type="button" data-days="1">Today</button>
<button type="button" data-days="7">7 days</button>
<button type="button" data-days="30">30 days</button>
<button type="button" data-days="90">90 days</button>
</div>
<p id="status" class="muted" aria-live="polite"></p>
<div id="banner" class="banner" role="alert" hidden>
<span id="banner-text"></span>
<button type="button" id="banner-retry">Try again</button>
</div>
<div id="usage-empty" class="card empty" hidden>
<strong>No usage in this range</strong>
<p id="empty-range" class="muted"></p>
<p class="muted">Calls to the model routes with an app key show up here within seconds. Pick a longer range or send a request, then refresh.</p>
</div>
<div id="usage-body">
<div id="totals" class="cards"></div>
<div id="minor" class="cards minor"></div>
<div class="charts">
<section class="card chart-card"><h2>Requests per day <span id="total-requests" class="muted"></span></h2><div id="chart-requests" class="chart"></div></section>
<section class="card chart-card"><h2>Estimated cost per day <span id="total-cost" class="muted"></span></h2><div id="chart-cost" class="chart"></div></section>
<section class="card chart-card"><h2>Tokens per day <span id="total-tokens" class="muted"></span></h2><div id="chart-tokens" class="chart"></div></section>
</div>
<h2>Apps</h2>
<div class="scroll card flush"><table id="apps"></table></div>
<h2>Models used</h2>
<div class="scroll card flush"><table id="models"></table></div>
<p id="models-more" class="muted" hidden><button type="button" id="models-toggle"></button></p>
</div>
</div>
<div id="view-models" role="tabpanel" aria-labelledby="tab-models" hidden>
<div id="catalog-auth" class="card" hidden>
<form id="catalog-key-form">
<label for="catalog-key">App key</label>
<div class="row">
<input id="catalog-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">
<button type="submit" class="primary">List models</button>
</div>
<p id="catalog-auth-note" class="muted"></p>
</form>
</div>
<div id="catalog-body">
<div class="toolbar">
<input id="catalog-search" type="search" placeholder="Filter by id" aria-label="Filter models by id" autocomplete="off" spellcheck="false">
<label class="check"><input type="checkbox" id="filter-tools"> Tools</label>
<label class="check"><input type="checkbox" id="filter-vision"> Vision</label>
</div>
<p id="catalog-status" class="muted" aria-live="polite"></p>
<div class="scroll card flush"><table id="catalog"></table></div>
<p id="catalog-more" class="muted" hidden><button type="button" id="catalog-toggle"></button></p>
</div>
</div>
</section>
</main>
</body>
</html>
`
