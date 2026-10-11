#!/usr/bin/env python3
"""Tiny logging reverse proxy for capturing raw client <-> plugboard traffic. Stdlib only.

  python3 compat/tools/logproxy.py [--port 4011] [--upstream http://127.0.0.1:4010] [--out compat/traffic/<client>.jsonl]

Point the client's base URL at http://127.0.0.1:4011/v1 (same key). Every exchange is appended to the
JSONL file as one object: {t, method, path, req_headers, req_body, status, resp_headers, resp_body, elapsed_s}.
Authorization is redacted. SSE and chunked responses are streamed through unbuffered and logged whole.
`req_body` / `resp_body` are strings (parsed into JSON under `req_json` / `resp_json` when possible).
Read it with: jq -c '{path,status,req_json,resp_body}' compat/traffic/<client>.jsonl

Captures are sensitive. Only the Authorization header is redacted; prompts, responses, tool arguments and other
headers (cookies, API keys in custom headers) are logged as sent. The file is created with mode 600 and compat/traffic/
is gitignored. Do not commit or paste captures; quote synthetic excerpts in results instead.

The upstream must be plain HTTP (http://host:port). HTTPS upstreams are rejected rather than silently sent in clear text.
"""
import argparse, http.client, json, sys, threading, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOP = {"connection", "keep-alive", "transfer-encoding", "content-length", "proxy-connection", "upgrade", "te", "trailer"}
lock = threading.Lock()


def make_handler(up, out):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"  # close-delimited responses: simplest correct streaming passthrough

        def log_message(self, *a):
            pass

        def _read_body(self):
            if self.headers.get("transfer-encoding", "").lower() == "chunked":
                buf = b""
                while True:
                    size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
                    if size == 0:
                        self.rfile.readline()
                        return buf
                    buf += self.rfile.read(size)
                    self.rfile.readline()
            n = int(self.headers.get("content-length") or 0)
            return self.rfile.read(n) if n else b""

        def _handle(self):
            t0 = time.time()
            body = self._read_body()
            hdrs = {k: v for k, v in self.headers.items() if k.lower() not in HOP and k.lower() != "host"}
            conn = http.client.HTTPConnection(up.hostname, up.port or 80, timeout=900)
            try:
                conn.request(self.command, self.path, body=body or None, headers=hdrs)
                r = conn.getresponse()
            except Exception as e:
                self.send_error(502, f"upstream error: {e}")
                return
            self.send_response(r.status)
            rh = {}
            for k, v in r.getheaders():
                rh[k] = v
                if k.lower() not in HOP:
                    self.send_header(k, v)
            self.send_header("Connection", "close")
            self.end_headers()
            chunks = []
            try:
                while True:
                    c = r.read1(8192) if hasattr(r, "read1") else r.read(8192)
                    if not c:
                        break
                    chunks.append(c)
                    self.wfile.write(c)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                chunks.append(b"\n[proxy: client disconnected]")
            finally:
                conn.close()
            rec = {
                "t": t0, "elapsed_s": round(time.time() - t0, 3), "method": self.command, "path": self.path,
                "req_headers": {k: ("<redacted>" if k.lower() == "authorization" else v) for k, v in self.headers.items()},
                "req_body": body.decode("utf-8", "replace"), "status": r.status, "resp_headers": rh,
                "resp_body": b"".join(chunks).decode("utf-8", "replace"),
            }
            for src, dst in (("req_body", "req_json"), ("resp_body", "resp_json")):
                try:
                    rec[dst] = json.loads(rec[src])
                except Exception:
                    pass
            with lock, open(out, "a") as f:
                f.write(json.dumps(rec) + "\n")

        do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = _handle

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4011)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--upstream", default="http://127.0.0.1:4010")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    up = urllib.parse.urlparse(a.upstream)
    if up.scheme != "http" or not up.hostname:
        sys.exit(f"--upstream must be an http:// URL (got {a.upstream!r}); logproxy does not speak HTTPS")
    out = Path(a.out or Path(__file__).resolve().parents[1] / "traffic" / f"{int(time.time())}.jsonl")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.touch(mode=0o600)
    print(f"logproxy {a.host}:{a.port} -> {a.upstream}, logging to {out}", file=sys.stderr, flush=True)
    ThreadingHTTPServer((a.host, a.port), make_handler(up, out)).serve_forever()


if __name__ == "__main__":
    main()
