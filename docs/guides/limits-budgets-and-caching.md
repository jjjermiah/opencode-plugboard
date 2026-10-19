# Limits, budgets and caching

**The problem.** A runaway loop in one app should not use up your quota or starve the others. A poller that sends the same prompt every minute should not pay for it every minute.

## Cap concurrency and rate

`limits` caps how many model calls run at once, and how many an app may start per minute. Nothing queues. A call over a cap gets a 429 at once, so the provider never sees it.

```jsonc plugboard
"limits": {
  "maxConcurrent": 8,
  "perApp": { "maxConcurrent": 2, "requestsPerMinute": 30 },
  "apps": { "coding": { "maxConcurrent": 4 } }
}
```

`coding` gets four calls at once and still 30 per minute, because `apps.<name>` overrides `perApp` field by field. A refused call carries `Retry-After`:

```
HTTP/1.1 429 Too Many Requests
retry-after: 12

{"error": {"message": "Too many requests per minute", "code": "rate_limit_exceeded", "type": "rate_limit_error", "param": null}}
```

A full concurrency cap answers `too_many_requests` with `retry-after: 1`. The `code` is on the OpenAI and Gemini routes. The Anthropic `/v1/messages` error has a `type` and a `message` only. The counts live in the server process, so a restart clears them.

## Cap spend

`budgets` sets ceilings per app for a UTC day, week or month: requests, tokens or cost. It reads the usage records, so `usage` must stay on.

```jsonc plugboard
"budgets": {
  "perApp": { "requests": { "day": 1000 }, "tokens": { "month": 20000000 } },
  "apps": { "coding": { "costUsd": { "month": 50 } } }
}
```

An app over a ceiling gets 429 `budget_exceeded` until the window resets. The server logs `budget.warning` at 80%. The check runs before a call starts, so the call that crosses a ceiling is still served. Budgets guard against runaway use. They are not an exact meter. Cost is an estimate at list prices.

## Cap the size of one request

- `maxTools` (default 64) caps the tools one request may carry. `maxN` (default 1) caps how many answers one request may ask for with `n`, because each is a full model call.
- `limits.maxBodyBytes` caps the size of one request body. The default, 32 MiB, is also the most it can be.

## Replay repeated answers

Pollers and bots often send the same prompt again and again. With `cache`, an identical request from the same app gets the stored answer. No session is created and no provider call is made.

```jsonc plugboard
"cache": { "ttlSeconds": 300, "apps": ["discord-bot"] }
```

Every answer says whether it came from the cache:

```
x-plugboard-cache: hit
```

Only normal text answers are kept. Answers with tool calls, errors, structured output and `n` above 1 are not. With `temperature` above 0, a hit repeats the first answer, so limit the cache to apps that want that. The cache is in memory and a restart empties it. A hit takes no concurrency slot and spends no budget.

## Keep the provider's prompt cache warm

`promptCache` with `affinity: "anchor"` gives every request of an app the same cache key. It helps ChatGPT subscription models. Anthropic and Copilot GPT already cache without it.

```jsonc plugboard
"promptCache": { "affinity": "anchor", "scope": "app" }
```

## Related options

All in the [configuration reference](../configuration.md#limits-budgets-and-caching):

- [Concurrency and rate limits](../configuration.md#concurrency-and-rate-limits)
- [Request bodies](../configuration.md#request-bodies): `maxBodyBytes`, `maxBodyBytesInFlight`, `bodyReadTimeoutMs`, `bodyReadMaxMs`
- [Budgets](../configuration.md#budgets)
- [Response cache](../configuration.md#response-cache)
- [Prompt-cache affinity](../configuration.md#prompt-cache-affinity)
- `requestTimeoutMs`, per app too

Next: [Tools, structured output and images](tools-output-and-images.md).
