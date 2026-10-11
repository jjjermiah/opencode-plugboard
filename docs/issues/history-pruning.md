# Prune old request history

Plugboard keeps every request as a session under `$XDG_DATA_HOME/opencode-plugboard/<app>/`, forever. A chat app that makes a request per turn will fill that directory with sessions, and the OpenCode app home gets longer with them.

## Design notes

A `history.maxAgeDays` option (and possibly `history.maxSessions` per app) that deletes sessions past the limit.

The plugin session API has no `list`, so plugboard can't ask OpenCode which sessions it owns. It needs its own index: record the session ID, app and creation time when a request starts, persist it under the data root, and sweep on startup and on a timer. The sweep deletes through the session API, not by touching OpenCode's storage. Sessions that are still running are skipped.

Sessions created before the index existed won't be listed, so a first version should say so in the README, or scan the app directory once to seed the index.

If upstream adds a session list or archive API, replace the index with it.

## Acceptance

- With `history.maxAgeDays: 30`, a session older than 30 days is gone after the next sweep and a newer one is untouched.
- An in-flight request is never pruned.
- Default stays "keep forever".
- The README documents the option and the index file.
