/*
 * plugboard usage dashboard (#141). Plain browser script, no build step, served as /plugboard/dashboard/app.js.
 *
 * Data comes only from GET /plugboard/usage, with the key the person typed (kept in sessionStorage). Every
 * value that came from the server (app names, model ids) reaches the page through textContent or
 * attributes; nothing here writes markup from a string. The page sends no inline script or style (see page.ts).
 */
(function () {
  "use strict";

  var KEY_STORAGE = "plugboard.usage.key";
  var COLORS = ["#2f6fdb", "#e0701b", "#2a9d5b", "#b43fa6", "#c99700", "#d6336c", "#15877f", "#6b5ce7"];
  var CHART_HEIGHT = 220;
  var MODEL_ROWS = 20;
  var dark = window.matchMedia("(prefers-color-scheme: dark)");

  var state = { days: 7, report: null, sort: { key: "costUsd", dir: -1 }, charts: [] };

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

  // ---------------------------------------------------------------- formatting

  var integer = new Intl.NumberFormat(undefined);
  var compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  var dollars = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

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
    return total === 0 ? "n/a" : ((hits / total) * 100).toFixed(1) + "%";
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

  // ---------------------------------------------------------------- view state

  function setStatus(text) {
    $("status").textContent = text;
  }

  /** The `detail` of a problem+json answer (RFC 9457), or "" when there is none. */
  function problemDetail(response) {
    return response.json().then(
      function (body) {
        return body && typeof body.detail === "string" ? body.detail : "";
      },
      function () {
        return "";
      },
    );
  }

  function showSignIn(message) {
    destroyCharts();
    state.report = null;
    $("panel").hidden = true;
    $("signin").hidden = false;
    $("auth-error").hidden = !message;
    $("auth-error").textContent = message || "";
    $("key").focus();
  }

  function showPanel() {
    $("signin").hidden = true;
    $("panel").hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll("[data-days]"), function (button) {
      button.setAttribute("aria-pressed", String(Number(button.getAttribute("data-days")) === state.days));
    });
  }

  // ---------------------------------------------------------------- loading

  async function load() {
    var stored = sessionStorage.getItem(KEY_STORAGE);
    if (stored === null) return showSignIn("");
    showPanel();
    var from = utcDay(-(state.days - 1));
    var to = utcDay(0);
    setStatus("Loading " + from + " to " + to + " (UTC)...");
    var response;
    try {
      response = await fetch("/plugboard/usage?from=" + from + "&to=" + to, {
        headers: stored === "" ? {} : { authorization: "Bearer " + stored },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch (error) {
      setStatus("Could not reach plugboard. Check the connection and refresh.");
      return;
    }
    if (response.status === 401 || response.status === 403) {
      sessionStorage.removeItem(KEY_STORAGE);
      var refusal = await problemDetail(response);
      showSignIn(refusal || (response.status === 401 ? "That key was not accepted." : "This key may not read usage."));
      return;
    }
    if (!response.ok) {
      var detail = await problemDetail(response);
      setStatus("plugboard answered " + response.status + (detail ? ": " + detail : "") + ". Refresh to try again.");
      return;
    }
    state.report = await response.json();
    render();
    setStatus("Updated " + new Date().toLocaleTimeString() + ". " + from + " to " + to + " (UTC days).");
  }

  function render() {
    if (!state.report) return;
    renderTotals();
    renderApps();
    renderCharts();
    renderModels();
  }

  // ---------------------------------------------------------------- totals

  function stat(label, value, note) {
    return h("div", { class: "card stat" }, h("span", { class: "label" }, label), h("strong", null, value), note ? h("span", { class: "muted" }, note) : null);
  }

  function renderTotals() {
    var t = state.report.totals;
    var e = t.errors;
    var cards = [
      stat("Requests", fmtCount(t.requests), null),
      stat("Tokens", fmtCount(tokensOf(t)), "input " + fmtCount(t.tokens.input) + ", output " + fmtCount(t.tokens.output + t.tokens.reasoning)),
      stat("Estimated cost", fmtCost(t.costUsd), t.unpricedRequests > 0 ? t.unpricedRequests + " call(s) had no price" : null),
      stat("Errors", fmtCount(errorsOf(t)), "client " + e.client + ", server " + e.server + ", timeout " + e.timeout + ", disconnected " + e.disconnected),
      stat("Cache hit rate", fmtRate(t.cacheHits, t.cacheMisses), t.cacheHits + " hits, " + t.cacheMisses + " misses"),
      stat("Fallbacks", fmtCount(t.fallbacks), "retries on another target"),
      stat("Rate limited (429)", fmtCount(t.limited), null),
      stat("p95 latency", t.latency.p95Ms === null ? "n/a" : "\u2264 " + fmtMs(t.latency.p95Ms), "estimate from buckets"),
    ];
    $("totals").replaceChildren(...cards);
  }

  // ---------------------------------------------------------------- tables

  function sortable(label, key) {
    var active = state.sort.key === key;
    var arrow = active ? (state.sort.dir < 0 ? " \u2193" : " \u2191") : "";
    var button = h("button", { type: "button", "data-sort": key }, label + arrow);
    return h("th", { class: "num", "aria-sort": active ? (state.sort.dir < 0 ? "descending" : "ascending") : "none" }, button);
  }

  var SORT_VALUE = {
    requests: function (t) {
      return t.requests;
    },
    tokens: tokensOf,
    costUsd: function (t) {
      return t.costUsd;
    },
  };

  function renderApps() {
    var apps = state.report.apps;
    var names = Object.keys(apps).sort();
    var table = $("apps");
    table.replaceChildren();
    if (names.length === 0) {
      table.append(h("tr", null, h("td", null, "No usage in this range.")));
      return;
    }
    var value = SORT_VALUE[state.sort.key] || SORT_VALUE.costUsd;
    names.sort(function (a, b) {
      return (value(apps[a].totals) - value(apps[b].totals)) * state.sort.dir || (a < b ? -1 : a > b ? 1 : 0);
    });
    table.append(
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", null, "App"),
          sortable("Requests", "requests"),
          sortable("Tokens", "tokens"),
          sortable("Cost", "costUsd"),
          h("th", { class: "num" }, "Errors"),
          h("th", { class: "num" }, "p95"),
          h("th", null, "Last request"),
        ),
      ),
    );
    var body = h("tbody", null);
    names.forEach(function (name) {
      var t = apps[name].totals;
      body.append(
        h(
          "tr",
          null,
          h("td", null, name),
          h("td", { class: "num" }, integer.format(t.requests)),
          h("td", { class: "num" }, fmtCount(tokensOf(t))),
          h("td", { class: "num" }, fmtCost(t.costUsd)),
          h("td", { class: "num" }, integer.format(errorsOf(t))),
          h("td", { class: "num" }, t.latency.p95Ms === null ? "n/a" : "\u2264 " + fmtMs(t.latency.p95Ms)),
          h("td", null, fmtTime(t.lastRequestAt)),
        ),
      );
    });
    table.append(body);
  }

  function renderModels() {
    var totals = {};
    Object.keys(state.report.apps).forEach(function (name) {
      var models = state.report.apps[name].models;
      Object.keys(models).forEach(function (model) {
        var sum = totals[model] || { requests: 0, tokens: 0, costUsd: 0 };
        totals[model] = { requests: sum.requests + models[model].requests, tokens: sum.tokens + models[model].tokens, costUsd: sum.costUsd + models[model].costUsd };
      });
    });
    var rows = Object.keys(totals)
      .map(function (model) {
        return { model: model, usage: totals[model] };
      })
      .sort(function (a, b) {
        return b.usage.costUsd - a.usage.costUsd || b.usage.requests - a.usage.requests || (a.model < b.model ? -1 : 1);
      });
    var table = $("models");
    table.replaceChildren();
    $("models-note").textContent = rows.length > MODEL_ROWS ? "Top " + MODEL_ROWS + " of " + rows.length + " models, by cost." : rows.length === 0 ? "No model calls in this range." : "";
    if (rows.length === 0) return;
    table.append(h("thead", null, h("tr", null, h("th", null, "Model"), h("th", { class: "num" }, "Requests"), h("th", { class: "num" }, "Tokens"), h("th", { class: "num" }, "Cost"))));
    var body = h("tbody", null);
    rows.slice(0, MODEL_ROWS).forEach(function (row) {
      body.append(
        h(
          "tr",
          null,
          h("td", { class: "wrap" }, row.model),
          h("td", { class: "num" }, integer.format(row.usage.requests)),
          h("td", { class: "num" }, fmtCount(row.usage.tokens)),
          h("td", { class: "num" }, fmtCost(row.usage.costUsd)),
        ),
      );
    });
    table.append(body);
  }

  // ---------------------------------------------------------------- charts

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

  function renderChart(id, metric, fmt) {
    var container = $(id);
    container.replaceChildren();
    var data = dailySeries(metric);
    var hasData = data.series.some(function (values) {
      return values.some(function (v) {
        return v > 0;
      });
    });
    if (!hasData) {
      container.append(h("p", { class: "muted" }, "No usage in this range."));
      return;
    }
    if (!window.uPlot) {
      container.append(h("p", { class: "muted" }, "Charts need uplot.js, which did not load."));
      return;
    }
    var ink = dark.matches ? "#c9d1d9" : "#3d4551";
    var grid = dark.matches ? "#30363d" : "#e3e6ea";
    var options = {
      width: Math.max(260, container.clientWidth),
      height: CHART_HEIGHT,
      legend: { show: true },
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
        { stroke: ink, grid: { stroke: grid }, ticks: { stroke: grid } },
        {
          stroke: ink,
          grid: { stroke: grid },
          ticks: { stroke: grid },
          values: function (u, splits) {
            return splits.map(function (v) {
              return fmt(v);
            });
          },
        },
      ],
      series: [
        {},
        ...data.names.map(function (name, i) {
          return {
            label: name,
            stroke: COLORS[i % COLORS.length],
            width: 2,
            points: { show: true, size: 5 },
            value: function (u, v) {
              return v === null || v === undefined ? "" : fmt(v);
            },
          };
        }),
      ],
    };
    var plot = new window.uPlot(options, [data.xs].concat(data.series), container);
    state.charts.push(plot);
  }

  function renderCharts() {
    destroyCharts();
    renderChart("chart-requests", function (day) {
      return day.requests;
    }, function (v) {
      return fmtCount(v);
    });
    renderChart("chart-cost", function (day) {
      return day.costUsd;
    }, function (v) {
      return v >= 1 ? dollars.format(v) : "$" + v.toFixed(3);
    });
    renderChart("chart-tokens", tokensOf, function (v) {
      return fmtCount(v);
    });
  }

  function resizeCharts() {
    state.charts.forEach(function (chart) {
      var container = chart.root.parentNode;
      chart.setSize({ width: Math.max(260, container.clientWidth), height: CHART_HEIGHT });
    });
  }

  // ---------------------------------------------------------------- events

  $("key-form").addEventListener("submit", function (event) {
    event.preventDefault();
    sessionStorage.setItem(KEY_STORAGE, $("key").value.trim());
    $("key").value = "";
    load();
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-days]"), function (button) {
    button.addEventListener("click", function () {
      state.days = Number(button.getAttribute("data-days"));
      load();
    });
  });

  $("refresh").addEventListener("click", function () {
    load();
  });

  $("sign-out").addEventListener("click", function () {
    sessionStorage.removeItem(KEY_STORAGE);
    showSignIn("");
  });

  $("apps").addEventListener("click", function (event) {
    var button = event.target.closest("button[data-sort]");
    if (!button || !state.report) return;
    var key = button.getAttribute("data-sort");
    state.sort = { key: key, dir: state.sort.key === key ? -state.sort.dir : -1 };
    renderApps();
  });

  dark.addEventListener("change", function () {
    if (state.report) {
      renderTotals();
      renderCharts();
    }
  });

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCharts, 150);
  });

  load();
})();
