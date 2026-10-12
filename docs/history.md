# History

Every request is kept as an OpenCode session, so you can see what each app asked and what the model answered. Plugboard keeps the full caller transcript in each session (system prompt, messages, images as attachments, tool calls and results) plus the reply. The title is the first user message. When the caller sent an end user (`user`, or Anthropic's `metadata.user_id`), the title starts with it, as `[alice] ...`; see [End users](configuration.md#end-users). A ten-turn chat is ten sessions, each complete. Every chat response carries an `x-plugboard-session` header with the id of its session.

Each session is filed under a per-app directory, so it never shows up in your real projects:

```
$XDG_DATA_HOME/opencode-plugboard/<app>/        # default ~/.local/share/opencode-plugboard/<app>/
```

That directory only groups sessions: it is the `directory` a session is filed under. The prompts and replies are not stored in it. OpenCode keeps them in its own database, `opencode.db` in its data directory (`opencode debug paths` prints the exact location, and `OPENCODE_DB` can override it). So deleting, locking down or backing up the app directory removes, protects or saves no history. To back up, restrict or purge history, work on that database, or remove sessions through OpenCode ([`compat/tools/sessions.py`](https://github.com/jjjermiah/opencode-plugboard/blob/main/compat/tools/sessions.py) does that for one app).

In OpenCode the sessions appear as one group per app in the desktop and phone app home screen. In the TUI they are visible in the all-projects view (ctrl+a), not in a project's own list. Set `history` to delete old ones: sweeps run on requests, at most every 10 minutes, in bounded batches, and never touch a running session. Only sessions created while a limit is set are pruned; remove older ones with `compat/tools/sessions.py`.

OpenCode loads plugin hooks per directory, so plugboard has to be loaded in those app directories, which is why it needs the global config. Everywhere outside the data root it is inert: it only joins the shared listener and registers no hooks, tools or agent rules, so your real projects behave as before.

History records every prompt and reply, so treat OpenCode's database as sensitive.
