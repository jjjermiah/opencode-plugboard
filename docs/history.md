# History

Every request is kept as an OpenCode session, so you can see what each app asked and what the model answered. Plugboard keeps the full caller transcript in each session (system prompt, messages, images as attachments, tool calls and results) plus the reply. A ten-turn chat is ten sessions, each complete.

- **Title.** The first user message. When the caller sent an end user (`user`, or Anthropic's `metadata.user_id`), the title starts with it, as `[alice] ...`. See [End users](configuration.md#end-users).
- **Session header.** Every chat response carries an `x-plugboard-session` header with the id of its session. With option `sessionUrl` set, it also carries `x-plugboard-session-url`, a link to that session's page. See [Session links](configuration.md#session-links).

## Where it lives

Each session is filed under a per-app directory, so it never shows up in your real projects:

```
$XDG_DATA_HOME/opencode-plugboard/<app>/        # default ~/.local/share/opencode-plugboard/<app>/
```

That directory only groups sessions: it is the `directory` a session is filed under. The prompts and replies are not stored in it. OpenCode keeps them in its own database, `opencode.db` in its data directory (`opencode debug paths` prints the exact location, and `OPENCODE_DB` can override it). So deleting, locking down or backing up the app directory removes, protects or saves no history. To back up, restrict or purge history, work on that database, or remove sessions through OpenCode ([`examples/_tools/sessions.py`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/_tools/sessions.py) does that for one app).

History records every prompt and reply, so treat OpenCode's database as sensitive.

## Request records

Beside each session, plugboard keeps a record of the HTTP exchange that made it (option `history.storeRequestBody`, on by default, per app or global): the request as received, the full response as sent, the timing, the routing, the usage and every error. A streamed answer is stored as its raw SSE bytes and as the assembled final answer. The outputs are the model's full answers, not only the prompts. Records live in the same OpenCode database, are not capped, and are not removed when their session is pruned. An app's key reads its own with `GET /plugboard/requests/{request id or session id}`. See [Stored requests](configuration.md#stored-requests).

## Where you see it

In OpenCode the sessions appear as one group per app in the desktop and phone app home screen. In the TUI they are visible in the all-projects view (ctrl+a), not in a project's own list.

With `sessions.hideFromList` they are children of one `plugboard: <app>` parent instead, and the lists show that parent rather than each request. See [Hidden app sessions](configuration.md#hidden-app-sessions). The sessions and their pruning are the same either way.

## Pruning

Sessions older than 30 days are deleted by default (`sessions.maxAgeDays`). `maxAgeDays: 0` keeps them.

Each app can set its own `sessions` (`apps.<name>.sessions`). A field replaces the global one for that app and an unset field falls back to it, so a bot can keep 20 sessions while a coding app keeps 5000. Two things to know:

- The global `maxAgeDays` defaults to 30, so an app that sets only `maxSessions` is still pruned after 30 days. Set its `maxAgeDays` to keep it longer.
- An app cannot set `0` (keep forever). Use a large value such as `36500`.

Sweeps run on requests, at most every 10 minutes, in bounded batches, and never touch a running session. Pruning covers the sessions plugboard has indexed. A session created before the index existed is never pruned: remove it with `examples/_tools/sessions.py`. OpenCode's own backups keep copies of pruned sessions.

## Plugin loading

OpenCode loads plugin hooks per directory, so plugboard has to be loaded in those app directories, which is why it needs the global config. Everywhere outside the data root it is inert: it only joins the shared listener and registers no hooks, tools or agent rules, so your real projects behave as before.
