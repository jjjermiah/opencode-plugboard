#!/usr/bin/env python3
"""List or delete plugboard history sessions of one app on an OpenCode server. Other apps are never touched.

  python3 examples/_tools/sessions.py list                          # sessions of the app: id, time, model, title
  python3 examples/_tools/sessions.py delete --all --dry-run        # show what would go
  python3 examples/_tools/sessions.py delete --older-than 60        # only sessions older than 60 minutes
  python3 examples/_tools/sessions.py delete ses_abc ses_def        # specific ids (refused unless they belong to the app)

Environment:
  PLUGBOARD_OC         command that runs the OpenCode CLI against the server you mean (default: opencode).
                       Use a wrapper script when the server needs its own HOME/XDG dirs; see docs/development.md.
  PLUGBOARD_DATA_ROOT  plugboard data root (default: $XDG_DATA_HOME/opencode-plugboard, else ~/.local/share/opencode-plugboard)

Options: --app NAME (default: compat). Sessions are matched on metadata.plugboard.app == NAME.
Parallel client runs share one app, so prefer --older-than or explicit ids while others are running.
"""
import argparse, json, os, shlex, subprocess, sys, time
from pathlib import Path

OC = shlex.split(os.environ.get("PLUGBOARD_OC", "opencode"))
DATA_ROOT = Path(os.environ.get("PLUGBOARD_DATA_ROOT") or Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "opencode-plugboard")


def api(*args):
    r = subprocess.run([*OC, "api", *args], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"{' '.join(OC)} api {' '.join(args)} failed: {r.stderr or r.stdout}")
    return json.loads(r.stdout) if r.stdout.strip() else {}


def app_sessions(app):
    directory = str(DATA_ROOT / app)
    out, cursor = [], None
    while True:
        args = ["session.list", "--param", f"directory={directory}", "--param", "limit=100"]
        if cursor:
            args += ["--param", f"cursor={cursor}"]
        page = api(*args)
        data = page.get("data", [])
        out += [s for s in data if s.get("metadata", {}).get("plugboard", {}).get("app") == app]
        cursor = (page.get("cursor") or {}).get("next")
        if len(data) < 100 or not cursor:
            return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "delete"])
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--app", default="compat")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--older-than", type=float, help="minutes")
    ap.add_argument("--dry-run", action="store_true", help="print the sessions that would be deleted and delete nothing")
    a = ap.parse_args()
    ss = app_sessions(a.app)
    if a.cmd == "list":
        for s in ss:
            t = time.strftime("%H:%M:%S", time.localtime(s["time"]["created"] / 1000))
            print(s["id"], t, s["metadata"]["plugboard"].get("model"), "|", s.get("title", "")[:60])
        print(f"{len(ss)} sessions in app {a.app!r} under {DATA_ROOT / a.app}")
        return
    if a.ids:
        by = {s["id"]: s for s in ss}
        bad = [i for i in a.ids if i not in by]
        if bad:
            sys.exit(f"refusing: not sessions of app {a.app!r}: {bad}")
        victims = [by[i] for i in a.ids]
    elif a.all or a.older_than is not None:
        cutoff = time.time() * 1000 - (a.older_than or 0) * 60000
        victims = [s for s in ss if s["time"]["created"] <= cutoff]
    else:
        sys.exit("give ids, --all or --older-than N")
    if a.dry_run:
        for s in victims:
            print("would delete", s["id"], s.get("title", "")[:60])
        print(f"dry run: {len(victims)} of {len(ss)} sessions would be deleted")
        return
    for s in victims:
        api("session.remove", "--param", f"sessionID={s['id']}")
    print(f"deleted {len(victims)} of {len(ss)} sessions")


if __name__ == "__main__":
    main()
