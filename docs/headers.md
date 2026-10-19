# Response headers

Plugboard adds `x-plugboard-*` headers to model answers. They tell you what happened to a request without reading logs. A browser page can read them when its origin is in [`cors.origins`](configuration.md#browser-origins).

A streamed answer sends its headers with the first event, so headers that need the finished answer (`x-plugboard-usage`, `x-plugboard-server-tools`) are only on non-streamed answers.

| Header | When | Value |
| --- | --- | --- |
| `x-plugboard-request-id` | Every response | 12 hex characters. The same id is on the request's log lines. |
| `x-plugboard-model` | Every answer | The `provider/model#variant` that answered. With a fallback chain, the target that won. |
| `x-plugboard-fallbacks` | A fallback chain moved past a failing target | How many targets failed before the one that answered. |
| `x-plugboard-session` | Every answer | The OpenCode session id of the request. See [History](history.md). |
| `x-plugboard-session-url` | `historyUrl` is set | A link to that session's page. |
| `x-plugboard-usage` | Usage recording on, not streamed | `input=<n>; output=<n>; cache_read=<n>; cache_write=<n>; cost_usd=<x>`. The cost is left out for a model with no price. |
| `x-plugboard-cache` | The app uses the response cache | `hit` or `miss`. |
| `x-plugboard-affinity` | The app uses prompt-cache anchors | `anchor`, or `none` when the request got no anchor. |
| `x-plugboard-dropped-params` | Sampling parameters were dropped | The dropped names, comma separated, such as `temperature,top_p`. See [`dropUnsupportedParams`](configuration.md#options). |
| `x-plugboard-thinking` | Thinking or a reasoning effort was asked for, and the model has no variant for it | `unavailable`. The request ran without thinking. |
| `x-plugboard-policy` | The app's policy changed the request | `tools-stripped`: the app has `tools: false` and the caller's tools were removed. |
| `x-plugboard-parallel-tools` | `parallel_tool_calls: false` | `limited`: only the first tool call of the answer was kept. |
| `x-plugboard-server-tools` | The app runs server tools, not streamed | The number of server tool calls OpenCode ran. |
| `x-plugboard-structured-fallback` | Structured output came from plain text | `text`: the model answered in text that matched the schema instead of calling `respond`. |
| `x-plugboard-user-dropped` | The end user name was not usable | `1`: the `user` value was not kept for usage. |

Errors from plugboard-owned routes (`/plugboard/*`) use `application/problem+json`. Model routes answer errors in their own API's shape. See [Errors](errors.md).
