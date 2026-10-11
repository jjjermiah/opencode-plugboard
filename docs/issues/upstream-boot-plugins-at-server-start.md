# Upstream request: load plugins when the server starts

Draft of an issue for the OpenCode repo, to file once plugboard v0.1 is out.

OpenCode V2 loads plugins per location, and it boots a location only when a client first touches it. After `opencode serve` starts, no plugin has run. A plugin that owns a long-lived resource, like plugboard's HTTP listener, isn't up until something happens to call the server. On a dev server we saw the port closed after a restart, then open about 2 seconds after a single `opencode api get /api/agent`.

Plugboard works around it by documenting a warm-up call in the systemd unit or launchd job. That is fine for us, but every plugin with a background service will rediscover it.

## Proposal

An opt-in way to boot plugins at server start. Any of these would do:

- A global config flag, such as `plugins[].eager: true`, that loads the plugin in the server's default location at start.
- A `server` entry point a plugin can declare, run once per process.
- A `boot` option on `opencode serve` that warms the default location.

The cost is startup time for plugins that opt in, so default off.

## Acceptance

- With the option set, a plugin's setup runs before the first client request, and plugboard's listener is up after `opencode serve` starts with no warm-up call.
- Plugins without the option behave as today.
- Plugboard's README drops the warm-up section, or keeps it only for older OpenCode versions.
