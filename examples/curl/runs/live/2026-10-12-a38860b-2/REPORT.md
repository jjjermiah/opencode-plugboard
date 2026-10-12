# Live run 2, curl, plugboard a38860b: one intermittent failure, suspected plugboard or upstream bug

`S1 (chat) on fast` failed in this run: `finish_reason` was `tool_calls`, `content` was null, and the reply had one tool call the request did not declare. Its function name was free text, not a tool name:

```
tool_calls[0].function.name = "Realtime-2.5-flash-2025-15‸none…I'm just a language model, so I can't actually play ping pong — but if you'd like, I can type \"pong\" back at you. 😄"
tool_calls[0].function.arguments = "{}"
```

The request had no `tools`, and the text that should have been `content` ended up in the name. This may be an upstream model fault, or a plugboard response mapping bug. The evidence does not separate them: the raw body is in `transcripts/S1.chat.fast.json`.

Five plain chat calls to `fast` made straight after this run each returned `stop` with `pong` and no tool calls. So the fault is intermittent, and one sample out of two live runs shows it. Not reproduced under control; no issue opened yet.

Not a gap of the example. The check correctly failed; this run stays as the record. The `messages.sh` budget fix is in this run (see `../2026-10-12-a38860b/REPORT.md`).
