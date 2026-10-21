/*
 * plugboard dashboard (#141). Plain browser script, no build step, served as /plugboard/dashboard/app.js.
 *
 * Data comes only from GET /plugboard/usage (the Usage tab) and GET /v1/models (the Models tab), with the key the
 * person typed (kept in sessionStorage). Every value that came from the server (app names, model ids) reaches the
 * page through textContent or attributes; nothing here writes markup from a string. The page sends no inline
 * script or style (see page.ts), so nothing here sets a style attribute either.
 */
(function () {
  "use strict";

  var KEY_STORAGE = "plugboard.usage.key";
  var MODELS_KEY_STORAGE = "plugboard.models.key";
  var DAYS_STORAGE = "plugboard.dashboard.days";
  var RANGES = [1, 7, 30, 90];
  var MODEL_ROWS = 10;
  var TAG_ROWS = 20;
  var CATALOG_ROWS = 100;
  var dark = window.matchMedia("(prefers-color-scheme: dark)");

  var state = {
    tab: location.hash === "#models" ? "models" : "usage",
    days: 7,
    report: null,
    reportDays: 7,
    previous: null,
    usageToken: 0,
    apps: { key: "costUsd", dir: -1 },
    models: { key: "costUsd", dir: -1 },
    showAllModels: false,
    charts: [],
    catalog: { rows: null, sort: { key: "id", dir: 1 }, query: "", tools: false, vision: false, showAll: false, open: {}, loading: false },
  };

  try {
    var savedDays = Number(sessionStorage.getItem(DAYS_STORAGE));
    if (RANGES.indexOf(savedDays) !== -1) state.days = savedDays;
  } catch (error) {
    // Session storage is unavailable: the default range stays.
  }

  function $(id) {
    return document.getElementById(id);
  }

  /** An element with static attributes and text children (strings become text nodes). */
  function h(tag, attrs) {
    var node = document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);
    Object.keys(attrs || {}).forEach(function (name) {
      node.setAttribute(name, attrs[name]);
    });
    children.forEach(function (child) {
      if (child !== null && child !== undefined) node.append(child);
    });
    return node;
  }

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  // ---------------------------------------------------------------- formatting

  var integer = new Intl.NumberFormat(undefined);
  var compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  var dollars = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  var percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

  function fmtCount(n) {
    return n >= 10000 ? compact.format(n) : integer.format(n);
  }
  function fmtCost(usd) {
    if (usd > 0 && usd < 0.005) return "<$0.01";
    return dollars.format(usd);
  }
  function fmtMs(ms) {
    if (ms === null || ms === undefined) return "n/a";
    if (ms >= 1000) return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + " s";
    return ms + " ms";
  }
  function fmtTime(iso) {
    return iso ? new Date(iso).toLocaleString() : "never";
  }
  function fmtRate(hits, misses) {
    var total = hits + misses;
    return total === 0 ? "n/a" : percent.format(hits / total);
  }
  /** USD per million tokens, as the catalog lists it: "$3", "$0.30", "free". */
  function fmtPrice(usd) {
    if (usd === null || usd === undefined) return "n/a";
    if (usd === 0) return "free";
    if (usd >= 1) return "$" + (Number.isInteger(usd) ? String(usd) : usd.toFixed(2));
    var text = String(Number(usd.toPrecision(3)));
    return "$" + (text.length < 4 ? usd.toFixed(2) : text);
  }

  function tokensOf(counts) {
    var t = counts.tokens;
    return t.input + t.cacheRead + t.cacheWrite + t.output + t.reasoning;
  }
  function errorsOf(counts) {
    var e = counts.errors;
    return e.client + e.server + e.timeout + e.disconnected;
  }

  /** The UTC calendar day `offset` days from today, YYYY-MM-DD. */
  function utcDay(offset) {
    var d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---------------------------------------------------------------- keys and requests

  function authHeaders(key) {
    return key === "" ? {} : { authorization: "Bearer " + key };
  }

  function requestInit(key) {
    return { headers: authHeaders(key), cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" };
  }

  function fetchUsage(from, to, key) {
    return fetch("/plugboard/usage?from=" + from + "&to=" + to, requestInit(key));
  }

  /** The message of an error answer: RFC 9457 `detail` (plugboard's own routes) or OpenAI's `error.message`; "" when there is none. */
  function problemDetail(response) {
    return response.json().then(
      function (body) {
        if (body && typeof body.detail === "string") return body.detail;
        if (body && body.error && typeof body.error.message === "string") return body.error.message;
        return "";
      },
      function () {
        return "";
      },
    );
  }

  // ---------------------------------------------------------------- view state

  function setStatus(text) {
    $("status").textContent = text;
  }

  function showBanner(text) {
    $("banner-text").textContent = text;
    $("banner").hidden = false;
  }

  function hideBanner() {
    $("banner").hidden = true;
  }

  function showSignIn(message) {
    destroyCharts();
    state.report = null;
    state.previous = null;
    state.catalog.rows = null;
    $("panel").hidden = true;
    $("signin").hidden = false;
    $("auth-error").hidden = !message;
    $("auth-error").textContent = message || "";
    $("key").focus();
  }

  function showPanel() {
    $("signin").hidden = true;
    $("panel").hidden = false;
    each(document.querySelectorAll("[data-days]"), function (button) {
      button.setAttribute("aria-pressed", String(Number(button.getAttribute("data-days")) === state.days));
    });
    selectTab(state.tab, false);
  }

  function selectTab(tab, remember) {
    state.tab = tab;
    each(document.querySelectorAll("[data-tab]"), function (button) {
      button.setAttribute("aria-selected", String(button.getAttribute("data-tab") === tab));
    });
    $("view-usage").hidden = tab !== "usage";
    $("view-models").hidden = tab !== "models";
    if (remember) history.replaceState(null, "", tab === "models" ? "#models" : location.pathname + location.search);
  }

  function refresh() {
    if (state.tab === "models") return loadCatalog();
    return loadUsage();
  }

  // ---------------------------------------------------------------- usage: loading

  function renderSkeleton() {
    var cards = [];
    for (var i = 0; i < 5; i++) cards.push(h("div", { class: "card stat skeleton", "aria-hidden": "true" }, h("span", { class: "label" }, "\u00a0"), h("strong", null, "\u00a0"), h("span", { class: "muted" }, "\u00a0")));
    $("totals").replaceChildren(...cards);
    $("minor").replaceChildren();
  }

  async function loadUsage() {
    var stored = sessionStorage.getItem(KEY_STORAGE);
    if (stored === null) return showSignIn("");
    showPanel();
    hideBanner();
    var span = state.days;
    var from = utcDay(-(span - 1));
    var to = utcDay(0);
    var token = ++state.usageToken;
    setStatus("Loading " + from + " to " + to + " (UTC)...");
    if (!state.report) {
      $("usage-empty").hidden = true;
      $("usage-body").hidden = false;
      renderSkeleton();
    }
    var current = fetchUsage(from, to, stored);
    // The previous period of the same length feeds the change arrows. It is optional: any failure leaves them out.
    var previous = fetchUsage(utcDay(-(2 * span - 1)), utcDay(-span), stored).then(
      function (response) {
        return response.ok ? response.json() : null;
      },
      function () {
        return null;
      },
    );
    var response;
    try {
      response = await current;
    } catch (error) {
      if (token !== state.usageToken) return;
      failUsage("Could not reach plugboard. Check the connection and try again.");
      return;
    }
    if (token !== state.usageToken) return;
    if (response.status === 401 || response.status === 403) {
      sessionStorage.removeItem(KEY_STORAGE);
      sessionStorage.removeItem(MODELS_KEY_STORAGE);
      var refusal = await problemDetail(response);
      showSignIn(refusal || (response.status === 401 ? "That key was not accepted." : "This key may not read usage."));
      return;
    }
    if (!response.ok) {
      var detail = await problemDetail(response);
      failUsage("plugboard answered " + response.status + (detail ? ": " + detail : "") + ".");
      return;
    }
    var report;
    try {
      report = await response.json();
      state.previous = await previous;
    } catch (error) {
      failUsage("plugboard sent a usage report this page could not read.");
      return;
    }
    if (token !== state.usageToken) return;
    state.report = report;
    state.reportDays = span;
    render();
    setStatus("Updated " + new Date().toLocaleTimeString() + ". " + from + " to " + to + " (UTC days).");
  }

  /** A failed load keeps what is on screen (if anything) and offers a retry. */
  function failUsage(message) {
    setStatus("");
    showBanner(message);
    if (!state.report) {
      $("totals").replaceChildren();
      $("minor").replaceChildren();
      $("usage-body").hidden = true;
    }
  }

  function render() {
    var report = state.report;
    if (!report) return;
    var empty = Object.keys(report.apps).length === 0 && report.totals.requests === 0;
    $("usage-empty").hidden = !empty;
    $("usage-body").hidden = empty;
    $("empty-range").textContent = "Nothing was counted from " + report.from + " to " + report.to + " (UTC).";
    if (empty) {
      destroyCharts();
      return;
    }
    renderTotals();
    renderCharts();
    renderApps();
    renderModels();
    renderTags();
  }

  // ---------------------------------------------------------------- usage: cards

  /** The change arrow against the previous period. `badWhenUp` marks metrics where more is worse (errors). */
  function delta(now, before, badWhenUp) {
    if (!state.previous || before === null || before === undefined) return null;
    var label = "vs the previous " + (state.reportDays === 1 ? "day" : state.reportDays + " days") + " (" + state.previous.from + " to " + state.previous.to + ")";
    if (before === 0) return now === 0 ? null : h("span", { class: "delta flat", title: label }, "new");
    var change = (now - before) / before;
    if (Math.abs(change) < 0.0005) return h("span", { class: "delta flat", title: label }, "no change");
    var up = change > 0;
    var tone = badWhenUp ? (up ? "bad" : "good") : "flat";
    return h("span", { class: "delta " + tone, title: label }, (up ? "\u25b2 " : "\u25bc ") + percent.format(Math.abs(change)));
  }

  function stat(label, value, note, change) {
    return h("div", { class: "card stat" }, h("span", { class: "label" }, label), h("strong", null, value), change, note ? h("span", { class: "muted" }, note) : null);
  }

  function renderTotals() {
    var t = state.report.totals;
    var p = state.previous ? state.previous.totals : null;
    var e = t.errors;
    var errors = errorsOf(t);
    $("totals").replaceChildren(
      stat("Requests", fmtCount(t.requests), t.lastRequestAt ? "last " + fmtTime(t.lastRequestAt) : null, delta(t.requests, p && p.requests, false)),
      stat("Tokens", fmtCount(tokensOf(t)), "input " + fmtCount(t.tokens.input + t.tokens.cacheRead + t.tokens.cacheWrite) + ", output " + fmtCount(t.tokens.output + t.tokens.reasoning), delta(tokensOf(t), p && tokensOf(p), false)),
      stat("Estimated cost", fmtCost(t.costUsd), t.unpricedRequests > 0 ? t.unpricedRequests + " call(s) had no price" : "list prices", delta(t.costUsd, p && p.costUsd, false)),
      stat("Errors", fmtCount(errors), (t.requests > 0 ? percent.format(errors / t.requests) + " of requests. " : "") + "client " + e.client + ", server " + e.server + ", timeout " + e.timeout, delta(errors, p && errorsOf(p), true)),
      stat("Cache hits", fmtCount(t.cacheHits), t.cacheHits + t.cacheMisses === 0 ? "response cache not used" : fmtRate(t.cacheHits, t.cacheMisses) + " hit rate, " + fmtCount(t.cacheMisses) + " misses", delta(t.cacheHits, p && p.cacheHits, false)),
    );
    var apps = Object.keys(state.report.apps).length;
    var models = modelRows().length;
    $("minor").replaceChildren(
      stat("p95 latency", t.latency.p95Ms === null ? "n/a" : "\u2264 " + fmtMs(t.latency.p95Ms), "estimate from buckets"),
      stat("Fallbacks", fmtCount(t.fallbacks), "retries on another target"),
      stat("Rate limited (429)", fmtCount(t.limited), null),
      stat("Apps", fmtCount(apps), null),
      stat("Models", fmtCount(models), null),
    );
  }

  // ---------------------------------------------------------------- tables

  /** The next sort when a header is clicked: text columns start ascending, numbers descending; a second click flips it. */
  function nextSort(sort, key, textual) {
    return { key: key, dir: sort.key === key ? -sort.dir : textual ? 1 : -1 };
  }

  function sortHeader(label, key, sort, textual) {
    var active = sort.key === key;
    var arrow = active ? (sort.dir < 0 ? " \u2193" : " \u2191") : "";
    var button = h("button", { type: "button", "data-sort": key, "data-text": textual ? "1" : "0" }, label + arrow);
    return h("th", { class: textual ? "" : "num", scope: "col", "aria-sort": active ? (sort.dir < 0 ? "descending" : "ascending") : "none" }, button);
  }

  function sortRows(rows, sort, getters) {
    var get = getters[sort.key];
    rows.sort(function (a, b) {
      var x = get(a);
      var y = get(b);
      var order = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y)) : x - y;
      return order * sort.dir || String(a.name).localeCompare(String(b.name));
    });
    return rows;
  }

  /** A number with a bar under it: the share of the column total. */
  function shareCell(text, value, total) {
    var bar = h("progress", { max: String(total > 0 ? total : 1), value: String(total > 0 ? value : 0), "aria-hidden": "true" });
    return h("td", { class: "num share" }, h("div", { class: "cell" }, h("span", null, text), bar));
  }

  var APP_SORT = {
    name: function (r) {
      return r.name;
    },
    requests: function (r) {
      return r.totals.requests;
    },
    tokens: function (r) {
      return tokensOf(r.totals);
    },
    costUsd: function (r) {
      return r.totals.costUsd;
    },
    errors: function (r) {
      return errorsOf(r.totals);
    },
    p95: function (r) {
      return r.totals.latency.p95Ms === null ? -1 : r.totals.latency.p95Ms;
    },
    last: function (r) {
      return r.totals.lastRequestAt || "";
    },
  };

  function renderApps() {
    var apps = state.report.apps;
    var rows = Object.keys(apps).map(function (name) {
      return { name: name, totals: apps[name].totals };
    });
    var sort = state.apps;
    var table = $("apps");
    table.replaceChildren();
    sortRows(rows, sort, APP_SORT);
    var totalCost = state.report.totals.costUsd;
    var totalRequests = state.report.totals.requests;
    table.append(
      h(
        "thead",
        null,
        h("tr", null, sortHeader("App", "name", sort, true), sortHeader("Requests", "requests", sort, false), sortHeader("Tokens", "tokens", sort, false), sortHeader("Cost", "costUsd", sort, false), sortHeader("Errors", "errors", sort, false), sortHeader("p95", "p95", sort, false), sortHeader("Last request", "last", sort, true)),
      ),
    );
    var body = h("tbody", null);
    rows.forEach(function (row) {
      var t = row.totals;
      body.append(
        h(
          "tr",
          null,
          h("th", { scope: "row", class: "name" }, row.name),
          shareCell(integer.format(t.requests), t.requests, totalRequests),
          h("td", { class: "num" }, fmtCount(tokensOf(t))),
          shareCell(fmtCost(t.costUsd), t.costUsd, totalCost),
          h("td", { class: "num" + (errorsOf(t) > 0 ? " warn" : "") }, integer.format(errorsOf(t))),
          h("td", { class: "num" }, t.latency.p95Ms === null ? "n/a" : "\u2264 " + fmtMs(t.latency.p95Ms)),
          h("td", null, fmtTime(t.lastRequestAt)),
        ),
      );
    });
    table.append(body);
  }

  /** Per model, summed over the apps of the range. */
  function modelRows() {
    var totals = {};
    Object.keys(state.report.apps).forEach(function (name) {
      var models = state.report.apps[name].models;
      Object.keys(models).forEach(function (model) {
        var sum = totals[model] || { requests: 0, tokens: 0, costUsd: 0 };
        totals[model] = { requests: sum.requests + models[model].requests, tokens: sum.tokens + models[model].tokens, costUsd: sum.costUsd + models[model].costUsd };
      });
    });
    return Object.keys(totals).map(function (model) {
      return { name: model, usage: totals[model] };
    });
  }

  var MODEL_SORT = {
    name: function (r) {
      return r.name;
    },
    requests: function (r) {
      return r.usage.requests;
    },
    tokens: function (r) {
      return r.usage.tokens;
    },
    costUsd: function (r) {
      return r.usage.costUsd;
    },
    perCall: function (r) {
      return r.usage.requests === 0 ? 0 : r.usage.costUsd / r.usage.requests;
    },
  };

  function renderModels() {
    var rows = modelRows();
    var sort = state.models;
    var table = $("models");
    table.replaceChildren();
    var more = $("models-more");
    if (rows.length === 0) {
      table.append(h("tbody", null, h("tr", null, h("td", { class: "empty-row" }, "No model calls in this range."))));
      more.hidden = true;
      return;
    }
    var totalCost = state.report.totals.costUsd;
    var totalRequests = 0;
    rows.forEach(function (row) {
      totalRequests += row.usage.requests;
    });
    sortRows(rows, sort, MODEL_SORT);
    var shown = state.showAllModels ? rows : rows.slice(0, MODEL_ROWS);
    table.append(h("thead", null, h("tr", null, sortHeader("Model", "name", sort, true), sortHeader("Requests", "requests", sort, false), sortHeader("Tokens", "tokens", sort, false), sortHeader("Cost", "costUsd", sort, false), sortHeader("Cost per call", "perCall", sort, false))));
    var body = h("tbody", null);
    shown.forEach(function (row) {
      var u = row.usage;
      body.append(
        h("tr", null, h("th", { scope: "row", class: "name wrap" }, row.name), shareCell(integer.format(u.requests), u.requests, totalRequests), h("td", { class: "num" }, fmtCount(u.tokens)), shareCell(fmtCost(u.costUsd), u.costUsd, totalCost), h("td", { class: "num" }, u.requests === 0 ? "n/a" : fmtCost(u.costUsd / u.requests))),
      );
    });
    table.append(body);
    more.hidden = rows.length <= MODEL_ROWS;
    $("models-toggle").textContent = state.showAllModels ? "Show the top " + MODEL_ROWS : "Show all " + rows.length + " models";
  }

  /** The tags table (the busiest TAG_ROWS, summed over the apps): shown only when some request in the range carried a tag. */
  function renderTags() {
    var totals = Object.create(null);
    Object.keys(state.report.apps).forEach(function (name) {
      var tags = state.report.apps[name].tags || {};
      Object.keys(tags).forEach(function (tag) {
        var sum = totals[tag] || { requests: 0, tokens: 0, costUsd: 0, errors: 0 };
        totals[tag] = { requests: sum.requests + tags[tag].requests, tokens: sum.tokens + tags[tag].tokens, costUsd: sum.costUsd + tags[tag].costUsd, errors: sum.errors + tags[tag].errors };
      });
    });
    var names = Object.keys(totals).sort(function (a, b) {
      return totals[b].requests - totals[a].requests || a.localeCompare(b);
    });
    $("tags-section").hidden = names.length === 0;
    var head = h("tr", null, h("th", { scope: "col" }, "Tag"), h("th", { scope: "col", class: "num" }, "Requests"), h("th", { scope: "col", class: "num" }, "Tokens"), h("th", { scope: "col", class: "num" }, "Cost"), h("th", { scope: "col", class: "num" }, "Errors"));
    var body = h("tbody", null);
    names.slice(0, TAG_ROWS).forEach(function (name) {
      var u = totals[name];
      body.append(h("tr", null, h("th", { scope: "row", class: "name wrap" }, name), h("td", { class: "num" }, integer.format(u.requests)), h("td", { class: "num" }, fmtCount(u.tokens)), h("td", { class: "num" }, fmtCost(u.costUsd)), h("td", { class: "num" + (u.errors > 0 ? " warn" : "") }, integer.format(u.errors))));
    });
    $("tags").replaceChildren(h("thead", null, head), body);
  }

  // ---------------------------------------------------------------- usage: charts

  function destroyCharts() {
    state.charts.forEach(function (chart) {
      chart.destroy();
    });
    state.charts = [];
  }

  /** One value per UTC day of the range, for every app that has records. Days without records are 0. */
  function dailySeries(metric) {
    var report = state.report;
    var dates = [];
    for (var at = Date.parse(report.from + "T00:00:00Z"); at <= Date.parse(report.to + "T00:00:00Z"); at += 86400000) {
      dates.push(new Date(at).toISOString().slice(0, 10));
    }
    var names = Object.keys(report.apps).sort();
    var series = names.map(function (name) {
      var byDate = {};
      report.apps[name].days.forEach(function (day) {
        byDate[day.date] = metric(day);
      });
      return dates.map(function (date) {
        return byDate[date] || 0;
      });
    });
    return {
      xs: dates.map(function (date) {
        return Date.parse(date + "T00:00:00Z") / 1000;
      }),
      names: names,
      series: series,
    };
  }

  function chartHeight() {
    return window.innerWidth < 640 ? 200 : 240;
  }

  function renderChart(id, totalId, metric, fmt) {
    var container = $(id);
    container.replaceChildren();
    var data = dailySeries(metric);
    var sum = 0;
    data.series.forEach(function (values) {
      values.forEach(function (v) {
        sum += v;
      });
    });
    $(totalId).textContent = sum > 0 ? "total " + fmt(sum) : "";
    if (data.xs.length < 2) {
      container.append(h("p", { class: "muted pad" }, "A trend needs two or more days. Pick 7 days or longer."));
      return;
    }
    if (sum <= 0) {
      container.append(h("p", { class: "muted pad" }, "Nothing to plot in this range."));
      return;
    }
    if (!window.uPlot) {
      container.append(h("p", { class: "muted pad" }, "Charts need uplot.js, which did not load."));
      return;
    }
    var ink = cssVar("--muted");
    var grid = cssVar("--line");
    var axis = { stroke: ink, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, font: "12px system-ui, sans-serif" };
    // The data is one point per day: never label finer than a day.
    var dayAxis = Object.assign({ incrs: [86400, 172800, 604800, 1209600, 2592000] }, axis);
    var options = {
      width: Math.max(240, container.clientWidth),
      height: chartHeight(),
      legend: { show: true, live: true },
      cursor: { drag: { x: false, y: false }, points: { size: 8 } },
      // Days are UTC calendar days, so the axis and the cursor read in UTC whatever the browser's zone is.
      tzDate: function (ts) {
        return window.uPlot.tzDate(new Date(ts * 1000), "Etc/UTC");
      },
      scales: {
        x: { time: true },
        // Counts and costs start at zero, whatever the smallest value is.
        y: {
          range: function (u, min, max) {
            return [0, max > 0 ? max * 1.1 : 1];
          },
        },
      },
      axes: [
        dayAxis,
        {
          stroke: ink,
          grid: axis.grid,
          ticks: axis.ticks,
          font: axis.font,
          size: 62,
          values: function (u, splits) {
            return splits.map(function (v) {
              return fmt(v);
            });
          },
        },
      ],
      series: [
        { label: "Day", value: "{YYYY}-{MM}-{DD}" },
        ...data.names.map(function (name, i) {
          var color = cssVar("--c" + ((i % 8) + 1));
          return {
            label: name,
            stroke: color,
            fill: color + "22",
            width: 2,
            points: { show: data.xs.length <= 31, size: 5, fill: color },
            value: function (u, v) {
              return v === null || v === undefined ? "" : fmt(v);
            },
          };
        }),
      ],
    };
    state.charts.push(new window.uPlot(options, [data.xs].concat(data.series), container));
  }

  function renderCharts() {
    destroyCharts();
    renderChart("chart-requests", "total-requests", function (day) {
      return day.requests;
    }, fmtCount);
    renderChart("chart-cost", "total-cost", function (day) {
      return day.costUsd;
    }, function (v) {
      return v >= 1 ? dollars.format(v) : "$" + v.toFixed(3);
    });
    renderChart("chart-tokens", "total-tokens", tokensOf, fmtCount);
  }

  function resizeCharts() {
    state.charts.forEach(function (chart) {
      var container = chart.root.parentNode;
      chart.setSize({ width: Math.max(240, container.clientWidth), height: chartHeight() });
    });
  }

  // ---------------------------------------------------------------- models tab

  /** The GET /v1/models entries as rows: id, provider, badges, context, price per million tokens. */
  function catalogRows(body) {
    var list = body && Array.isArray(body.data) ? body.data : [];
    return list
      .filter(function (entry) {
        return entry && typeof entry.id === "string";
      })
      .map(function (entry) {
        var info = entry.plugboard || {};
        var caps = info.capabilities || {};
        var owner = typeof entry.owned_by === "string" ? entry.owned_by : "";
        var base = Array.isArray(info.cost) ? info.cost.find(function (cost) {
          return cost.aboveContext === undefined;
        }) : undefined;
        var inputs = info.modalities && Array.isArray(info.modalities.input) ? info.modalities.input : [];
        var badges = [];
        if (info.agent !== undefined) badges.push({ text: "agent " + info.agent, kind: "alias" });
        else if (info.skill !== undefined) badges.push({ text: "skill " + info.skill, kind: "alias" });
        else if (owner !== "" && entry.id.indexOf(owner + "/") !== 0 && entry.id.indexOf(owner + "--") !== 0) badges.push({ text: "alias", kind: "alias" });
        if (caps.tools === true) badges.push({ text: "tools", kind: "cap" });
        if (caps.image === true) badges.push({ text: "vision", kind: "cap" });
        inputs.forEach(function (modality) {
          if (modality !== "text" && modality !== "image") badges.push({ text: modality, kind: "cap" });
        });
        if (typeof info.status === "string" && info.status !== "active") badges.push({ text: info.status, kind: "status" });
        return {
          name: entry.id,
          owner: owner,
          badges: badges,
          tools: caps.tools === true,
          vision: caps.image === true,
          context: typeof entry.context_length === "number" ? entry.context_length : null,
          output: typeof entry.max_output_tokens === "number" ? entry.max_output_tokens : null,
          input: base ? base.input : null,
          completion: base ? base.output : null,
        };
      });
  }

  var CATALOG_SORT = {
    id: function (r) {
      return r.name;
    },
    context: function (r) {
      return r.context === null ? -1 : r.context;
    },
    input: function (r) {
      return r.input === null ? -1 : r.input;
    },
    completion: function (r) {
      return r.completion === null ? -1 : r.completion;
    },
  };

  function showCatalogAuth(note) {
    $("catalog-auth").hidden = false;
    $("catalog-body").hidden = true;
    $("catalog-auth-note").textContent = note;
    $("catalog-key").focus();
  }

  async function loadCatalog() {
    var stored = sessionStorage.getItem(KEY_STORAGE);
    if (stored === null) return showSignIn("");
    showPanel();
    var own = sessionStorage.getItem(MODELS_KEY_STORAGE);
    var key = own !== null ? own : stored;
    $("catalog-auth").hidden = true;
    $("catalog-body").hidden = false;
    $("catalog-status").textContent = "Loading models...";
    state.catalog.loading = true;
    var response;
    try {
      response = await fetch("/v1/models", requestInit(key));
    } catch (error) {
      state.catalog.loading = false;
      $("catalog-status").textContent = "Could not reach plugboard. Check the connection and refresh.";
      return;
    }
    state.catalog.loading = false;
    if (response.status === 401 || response.status === 403) {
      if (own !== null) sessionStorage.removeItem(MODELS_KEY_STORAGE);
      showCatalogAuth(own !== null ? "That key was not accepted." : "The key you signed in with cannot list models: the admin key is not an app key. Enter an app key to see what it can call.");
      return;
    }
    if (!response.ok) {
      var detail = await problemDetail(response);
      $("catalog-status").textContent = "plugboard answered " + response.status + (detail ? ": " + detail : "") + ". Refresh to try again.";
      return;
    }
    var body;
    try {
      body = await response.json();
    } catch (error) {
      $("catalog-status").textContent = "plugboard sent a model list this page could not read.";
      return;
    }
    state.catalog.rows = catalogRows(body);
    renderCatalog();
  }

  function snippetFor(id, lang) {
    var base = location.origin + "/v1";
    var message = '[{"role": "user", "content": "Hello"}]';
    if (lang === "python") {
      return ["from openai import OpenAI", "import os", "", "client = OpenAI(base_url=" + JSON.stringify(base) + ', api_key=os.environ["PLUGBOARD_API_KEY"])', "reply = client.chat.completions.create(", "    model=" + JSON.stringify(id) + ",", '    messages=[{"role": "user", "content": "Hello"}],', ")", "print(reply.choices[0].message.content)"].join("\n");
    }
    if (lang === "js") {
      return ['import OpenAI from "openai"', "", "const client = new OpenAI({ baseURL: " + JSON.stringify(base) + ", apiKey: process.env.PLUGBOARD_API_KEY })", "const reply = await client.chat.completions.create({", "  model: " + JSON.stringify(id) + ",", '  messages: [{ role: "user", content: "Hello" }],', "})", "console.log(reply.choices[0].message.content)"].join("\n");
    }
    var payload = JSON.stringify({ model: id, messages: JSON.parse(message) }).replace(/'/g, "'\\''");
    return ["curl " + base + "/chat/completions \\", '  -H "Authorization: Bearer $PLUGBOARD_API_KEY" \\', '  -H "Content-Type: application/json" \\', "  -d '" + payload + "'"].join("\n");
  }

  var LANGS = [
    { id: "curl", label: "curl" },
    { id: "python", label: "Python" },
    { id: "js", label: "JavaScript" },
  ];

  function visibleCatalogRows() {
    var c = state.catalog;
    var query = c.query.trim().toLowerCase();
    var rows = c.rows.filter(function (row) {
      return (query === "" || row.name.toLowerCase().indexOf(query) !== -1) && (!c.tools || row.tools) && (!c.vision || row.vision);
    });
    return sortRows(rows, c.sort, CATALOG_SORT);
  }

  function badge(item) {
    return h("span", { class: "badge " + item.kind }, item.text);
  }

  function renderCatalog() {
    var c = state.catalog;
    var table = $("catalog");
    table.replaceChildren();
    if (!c.rows) return;
    var rows = visibleCatalogRows();
    var total = c.rows.length;
    $("catalog-status").textContent = total === 0 ? "This key can call no models. Check the plugboard `models` option and the key's app scope." : rows.length + " of " + total + " models. Prices are USD per million tokens.";
    $("catalog-more").hidden = true;
    if (total === 0) return;
    if (rows.length === 0) {
      table.append(h("tbody", null, h("tr", null, h("td", { class: "empty-row" }, "No model matches the filter."))));
      return;
    }
    var shown = c.showAll ? rows : rows.slice(0, CATALOG_ROWS);
    var sort = c.sort;
    table.append(h("thead", null, h("tr", null, sortHeader("Model", "id", sort, true), sortHeader("Context", "context", sort, false), sortHeader("Input", "input", sort, false), sortHeader("Output", "completion", sort, false))));
    var body = h("tbody", null);
    shown.forEach(function (row) {
      var open = c.open[row.name];
      body.append(
        h(
          "tr",
          { class: open ? "opened" : "" },
          h(
            "th",
            { scope: "row", class: "name wrap" },
            h("span", { class: "mid" }, row.name),
            h("span", { class: "badges" }, ...row.badges.map(badge)),
            h("span", { class: "badges" }, h("button", { type: "button", class: "small", "data-action": "copy-id", "data-id": row.name }, "Copy id"), h("button", { type: "button", class: "small", "data-action": "use", "data-id": row.name, "aria-expanded": String(Boolean(open)) }, open ? "Hide snippet" : "Snippet")),
          ),
          h("td", { class: "num" }, row.context === null ? "n/a" : compact.format(row.context)),
          h("td", { class: "num" }, fmtPrice(row.input)),
          h("td", { class: "num" }, fmtPrice(row.completion)),
        ),
      );
      if (open) body.append(snippetRow(row.name, open));
    });
    table.append(body);
    if (rows.length > CATALOG_ROWS) {
      $("catalog-more").hidden = false;
      $("catalog-toggle").textContent = c.showAll ? "Show the first " + CATALOG_ROWS : "Show all " + rows.length + " models";
    }
  }

  function snippetRow(id, lang) {
    var tabs = h("div", { class: "langs", role: "group", "aria-label": "Language" });
    LANGS.forEach(function (item) {
      tabs.append(h("button", { type: "button", class: "small", "data-action": "lang", "data-id": id, "data-lang": item.id, "aria-pressed": String(item.id === lang) }, item.label));
    });
    tabs.append(h("button", { type: "button", class: "small primary", "data-action": "copy-snippet", "data-id": id, "data-lang": lang }, "Copy snippet"));
    return h("tr", { class: "detail" }, h("td", { colspan: "4" }, tabs, h("pre", null, h("code", null, snippetFor(id, lang))), h("p", { class: "muted" }, "Set PLUGBOARD_API_KEY to an app key. The snippet never contains your key.")));
  }

  /** Copies text. `navigator.clipboard` exists only on secure origins; a plain http page falls back to a selected textarea. */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = h("textarea", { readonly: "", "aria-hidden": "true", class: "offscreen" });
      area.value = text;
      document.body.append(area);
      area.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (error) {
        ok = false;
      }
      area.remove();
      return ok ? resolve() : reject(new Error("copy refused"));
    });
  }

  function flash(button, text) {
    var before = button.getAttribute("data-label") || button.textContent;
    button.setAttribute("data-label", before);
    button.textContent = text;
    setTimeout(function () {
      button.textContent = before;
      button.removeAttribute("data-label");
    }, 1500);
  }

  function focusAction(action, id) {
    each($("catalog").querySelectorAll("button[data-action]"), function (button) {
      if (button.getAttribute("data-action") === action && button.getAttribute("data-id") === id) button.focus();
    });
  }

  // ---------------------------------------------------------------- events

  $("key-form").addEventListener("submit", function (event) {
    event.preventDefault();
    sessionStorage.setItem(KEY_STORAGE, $("key").value.trim());
    sessionStorage.removeItem(MODELS_KEY_STORAGE);
    $("key").value = "";
    state.report = null;
    state.catalog.rows = null;
    loadUsage().then(function () {
      if (state.tab === "models" && sessionStorage.getItem(KEY_STORAGE) !== null) loadCatalog();
    });
  });

  $("catalog-key-form").addEventListener("submit", function (event) {
    event.preventDefault();
    sessionStorage.setItem(MODELS_KEY_STORAGE, $("catalog-key").value.trim());
    $("catalog-key").value = "";
    loadCatalog();
  });

  each(document.querySelectorAll("[data-days]"), function (button) {
    button.addEventListener("click", function () {
      state.days = Number(button.getAttribute("data-days"));
      try {
        sessionStorage.setItem(DAYS_STORAGE, String(state.days));
      } catch (error) {
        // Not remembered; the choice still applies.
      }
      loadUsage();
    });
  });

  each(document.querySelectorAll("[data-tab]"), function (button) {
    button.addEventListener("click", function () {
      var tab = button.getAttribute("data-tab");
      selectTab(tab, true);
      if (tab === "models" && state.catalog.rows === null && !state.catalog.loading) loadCatalog();
      if (tab === "usage" && state.report === null) loadUsage();
    });
  });

  $("refresh").addEventListener("click", function () {
    refresh();
  });

  $("banner-retry").addEventListener("click", function () {
    loadUsage();
  });

  $("sign-out").addEventListener("click", function () {
    sessionStorage.removeItem(KEY_STORAGE);
    sessionStorage.removeItem(MODELS_KEY_STORAGE);
    showSignIn("");
  });

  function sortClick(event, get, set, redraw) {
    var button = event.target.closest("button[data-sort]");
    if (!button) return;
    set(nextSort(get(), button.getAttribute("data-sort"), button.getAttribute("data-text") === "1"));
    redraw();
    each(document.querySelectorAll("th button[data-sort]"), function (candidate) {
      if (candidate.getAttribute("data-sort") === button.getAttribute("data-sort") && candidate.closest("table") === button.closest("table")) candidate.focus();
    });
  }

  $("apps").addEventListener("click", function (event) {
    if (state.report)
      sortClick(
        event,
        function () {
          return state.apps;
        },
        function (value) {
          state.apps = value;
        },
        renderApps,
      );
  });

  $("models").addEventListener("click", function (event) {
    if (state.report)
      sortClick(
        event,
        function () {
          return state.models;
        },
        function (value) {
          state.models = value;
        },
        renderModels,
      );
  });

  $("models-toggle").addEventListener("click", function () {
    state.showAllModels = !state.showAllModels;
    renderModels();
  });

  $("catalog").addEventListener("click", function (event) {
    if (event.target.closest("button[data-sort]")) {
      return sortClick(
        event,
        function () {
          return state.catalog.sort;
        },
        function (value) {
          state.catalog.sort = value;
        },
        renderCatalog,
      );
    }
    var button = event.target.closest("button[data-action]");
    if (!button) return;
    var action = button.getAttribute("data-action");
    var id = button.getAttribute("data-id");
    if (action === "copy-id") {
      copyText(id).then(
        function () {
          flash(button, "Copied");
        },
        function () {
          flash(button, "Copy failed");
        },
      );
    } else if (action === "copy-snippet") {
      copyText(snippetFor(id, button.getAttribute("data-lang"))).then(
        function () {
          flash(button, "Copied");
        },
        function () {
          flash(button, "Copy failed");
        },
      );
    } else if (action === "use") {
      if (state.catalog.open[id]) delete state.catalog.open[id];
      else state.catalog.open[id] = "curl";
      renderCatalog();
      focusAction("use", id);
    } else if (action === "lang") {
      state.catalog.open[id] = button.getAttribute("data-lang");
      renderCatalog();
      each($("catalog").querySelectorAll("button[data-action=lang]"), function (candidate) {
        if (candidate.getAttribute("data-id") === id && candidate.getAttribute("data-lang") === state.catalog.open[id]) candidate.focus();
      });
    }
  });

  $("catalog-search").addEventListener("input", function () {
    state.catalog.query = $("catalog-search").value;
    state.catalog.showAll = false;
    renderCatalog();
  });
  $("filter-tools").addEventListener("change", function () {
    state.catalog.tools = $("filter-tools").checked;
    renderCatalog();
  });
  $("filter-vision").addEventListener("change", function () {
    state.catalog.vision = $("filter-vision").checked;
    renderCatalog();
  });
  $("catalog-toggle").addEventListener("click", function () {
    state.catalog.showAll = !state.catalog.showAll;
    renderCatalog();
  });

  dark.addEventListener("change", function () {
    if (state.report && !$("usage-body").hidden) renderCharts();
  });

  window.addEventListener("hashchange", function () {
    var tab = location.hash === "#models" ? "models" : "usage";
    if (tab === state.tab || $("panel").hidden) return;
    selectTab(tab, false);
    if (tab === "models" && state.catalog.rows === null) loadCatalog();
    if (tab === "usage" && state.report === null) loadUsage();
  });

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCharts, 150);
  });

  // First load: the Usage tab validates the key; a deep link to #models also lists the models.
  loadUsage().then(function () {
    if (state.tab === "models" && sessionStorage.getItem(KEY_STORAGE) !== null) loadCatalog();
  });
})();
