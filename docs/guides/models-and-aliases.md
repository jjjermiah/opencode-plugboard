# Models, aliases and fallbacks

**The problem.** Apps should not hard-code `anthropic/claude-sonnet-4-6`. You want to expose only some models, move apps to another model in one line, and survive a provider that is down or out of quota.

## Allow only what you choose

Nothing is exposed by accident. A model is callable only if `models` lists it, and `/v1/models` shows only those.

```jsonc
"models": [
  "anthropic/*",                 // every Claude model
  "openai/gpt-5.6-luna#low",     // one ChatGPT variant
  "github-copilot/*",            // every Copilot model
  "opencode-go/glm-5.3-flash"    // one exact model
]
```

A model outside the list answers 404:

```json
{"error": {"message": "Model openai/gpt-5 is not available", "code": "model_not_found", "type": "not_found_error", "param": "model"}}
```

`provider/model` allows any variant, `provider/model#variant` allows one, and `provider/*` allows a whole provider.

## Give models short names

An alias is a name a caller uses as `model`. Change the target in one line and every app that uses the alias moves with it.

```jsonc
"aliases": {
  "smart": "anthropic/claude-sonnet-4-6",
  "fast": "opencode-go/glm-5.3-flash"
}
```

Every answer carries `x-plugboard-model`, the model that actually answered:

```
x-plugboard-model: opencode-go/glm-5.3-flash
```

## Survive a failing provider

Point an alias at a list. If the first target fails before it sends any output, plugboard tries the next.

```jsonc
"aliases": {
  "fast": ["opencode-go/glm-5.3-flash", "anthropic/claude-haiku-4-5"]
}
```

What happens:

- A rate limit, quota error, provider outage or timeout moves the request on.
- Once any text or tool call has reached the client, a failure is not retried. A partly streamed answer is never restarted.
- A retried answer shows it:

```
x-plugboard-model: anthropic/claude-haiku-4-5
x-plugboard-fallbacks: 1
```

- Every target must be allowed in `models`, or the plugin refuses to load.
- A target that hangs without answering can be abandoned after a deadline: set `fallbackAfterMs`.
- A target that fails three times in a row is skipped for a minute, so a dead provider stops costing every request a failed call. After that one request probes it again, and an answer brings it back. If every target is cooling down, the first is still tried. Tune it with `fallbackCooldown`, or set it to `false` to turn it off. `GET /plugboard/status` shows the targets being skipped.

## Pin an app to one model

`apps.<name>.model` makes every request of that app run on one model, whatever the caller sends. Use it for a widget with a model name baked in.

## Chat UIs that break on `/` and `#`

```jsonc
"modelIds": "both"   // canonical ids and UI-safe slugs
```

`anthropic/claude-haiku-4-5#high` is then also listed as `anthropic--claude-haiku-4-5__high`. Requests accept either spelling. To list only models that can do something, ask for `/v1/models?capability=vision` or `?capability=tools`.

## Reasoning effort, skills and agents

- `reasoning_effort` in a request picks a model variant when the model name has none. Set `reasoningOutput: true` to get the model's reasoning back.
- An alias can bind an OpenCode skill to a model (`skill:<id>@provider/model`). The `agents` option exposes OpenCode agents as `agent/<name>`. They never run tools on the server.

## Related options

All in the [configuration reference](../configuration.md#models):

- [`models`](../configuration.md#models), [`modelIds`](../configuration.md#model-ids-in-uis)
- [`aliases` and fallbacks](../configuration.md#aliases-and-fallbacks), `fallbackAfterMs`, `fallbackCooldown`
- [`reasoningOutput`](../configuration.md#reasoning-output)
- [Skills and agents](../configuration.md#skills-and-agents)
- [`apps.<name>.models` and `apps.<name>.model`](../configuration.md#per-app-policy-apps)

Next: [Limits, budgets and caching](limits-budgets-and-caching.md).
