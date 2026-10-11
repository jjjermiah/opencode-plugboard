#!/usr/bin/env python3
"""List / delete plugboard history sessions of the `compat` app on the DEV OpenCode server. Never touches other apps.

  python3 compat/tools/sessions.py list                      # compat sessions: id, time, model, title
  python3 compat/tools/sessions.py delete --all              # delete every compat session
  python3 compat/tools/sessions.py delete --older-than 60    # only those older than 60 minutes
  python3 compat/tools/sessions.py delete ses_abc ses_def    # specific ids (refused unless they are compat sessions)

Wraps ~/.cache/opencode-adapter-dev/oc (isolated dev server). Filter is metadata.plugboard.app == "compat".
"""
import argparse, json, subprocess, sys, time
from pathlib import Path

OC = str(Path.home() / ".cache/opencode-adapter-dev/oc")
APP = "compat"


def api(*args):
    r = subprocess.run([OC, "api", *args], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"oc api {' '.join(args)} failed: {r.stderr or r.stdout}")
    return json.loads(r.stdout) if r.stdout.strip() else {}


DIR = str(Path.home() / ".cache/opencode-adapter-dev/home/.local/share/opencode-plugboard" / APP)


def compat_sessions():
    out, cursor = [], None
    while True:
        args = ["session.list", "--param", f"directory={DIR}", "--param", "limit=100"]
        if cursor:
            args += ["--param", f"cursor={cursor}"]
        page = api(*args)
        data = page.get("data", [])
        out += [s for s in data if s.get("metadata", {}).get("plugboard", {}).get("app") == APP]
        cursor = (page.get("cursor") or {}).get("next")
        if len(data) < 100 or not cursor:
            return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "delete"])
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--older-than", type=float, help="minutes")
    a = ap.parse_args()
    ss = compat_sessions()
    if a.cmd == "list":
        for s in ss:
            t = time.strftime("%H:%M:%S", time.localtime(s["time"]["created"] / 1000))
            print(s["id"], t, s["metadata"]["plugboard"].get("model"), "|", s.get("title", "")[:60])
        print(f"{len(ss)} compat sessions")
        return
    if a.ids:
        by = {s["id"]: s for s in ss}
        bad = [i for i in a.ids if i not in by]
        if bad:
            sys.exit(f"refusing: not compat-app sessions: {bad}")
        victims = [by[i] for i in a.ids]
    elif a.all or a.older_than is not None:
        cutoff = time.time() * 1000 - (a.older_than or 0) * 60000
        victims = [s for s in ss if s["time"]["created"] <= cutoff]
    else:
        sys.exit("give ids, --all or --older-than N")
    for s in victims:
        api("session.remove", "--param", f"sessionID={s['id']}")
    print(f"deleted {len(victims)} of {len(ss)} compat sessions")


if __name__ == "__main__":
    main()
