# Warm-up for always-on servers

OpenCode loads no plugin until a client touches the server, so after a restart the port stays closed until something connects. On a machine that runs `opencode serve` all the time, add one call right after start. Any request that makes OpenCode load a project works. `opencode api get /api/agent` does.

On Linux, in the OpenCode systemd unit (retry until the server answers; pass the same server credentials your service uses, if you set any):

```ini
[Service]
ExecStartPost=-/bin/sh -c 'for i in $(seq 1 30); do opencode api get /api/agent >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
```

On macOS, a launchd job (`~/Library/LaunchAgents/dev.plugboard.warmup.plist`). It runs once when launchd loads it, which is at login and after boot. It does not run again when OpenCode restarts by itself, so after an OpenCode restart on its own, touch the server yourself (`launchctl kickstart -k gui/$(id -u)/dev.plugboard.warmup` reruns it) or run the same command from whatever restarts OpenCode.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.plugboard.warmup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>for i in $(seq 1 30); do opencode api get /api/agent >/dev/null 2>&amp;1 &amp;&amp; exit 0; sleep 1; done; exit 1</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
```

If `opencode` is not on the job's `PATH`, use its full path. A request to `/healthz` before the warm-up gets connection refused, which is expected. I'd like OpenCode to boot plugins at server start so none of this is needed ([upstream request](https://github.com/jjjermiah/opencode-plugboard/issues/2)).

When config reloads happen, plugboard keeps the port open through a short grace period, so a reload does not drop connections. If no plugboard generation is alive when a request arrives, the caller gets a 503.

## Readiness: `/readyz`

`GET /readyz` needs no key. It answers `{"ready":true}` once a generation serves, the event pump runs and the model catalog has loaded. Until then it answers 503 `{"ready":false,"reason":...}` and names the first missing piece. Starting OpenCode is not enough: the app directory is confirmed by a model request to an app, and that request also starts the event pump and loads the catalog. So after a restart `/readyz` stays at 503 ("no app directory has been used since start") until one request reaches an app. A recorded invalid config (`configError`) is the reason on its own. `/healthz` stays a liveness check and says nothing about readiness.

The unit below warms the server with one small completion, then checks `/readyz`. Replace `fast` with a model your `models` option allows, and put the app's key in `PLUGBOARD_KEY` (for example with `EnvironmentFile=`). The completion is a real model call and counts toward usage.

```ini
[Service]
ExecStartPost=-/bin/sh -c 'for i in $(seq 1 30); do opencode api get /api/agent >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
ExecStartPost=-/bin/sh -c 'curl -fsS -m 120 http://127.0.0.1:4010/v1/chat/completions -H "Authorization: Bearer $PLUGBOARD_KEY" -H "content-type: application/json" -d "{\"model\":\"fast\",\"max_tokens\":1,\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}" >/dev/null'
ExecStartPost=-/bin/sh -c 'for i in $(seq 1 30); do curl -fsS http://127.0.0.1:4010/readyz >/dev/null && exit 0; sleep 2; done; exit 1'
```

A load balancer or monitor can point at `/readyz` the same way: `curl -fs` exits non-zero on a 503.
