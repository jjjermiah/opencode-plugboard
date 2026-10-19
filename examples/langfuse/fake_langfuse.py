"""A Langfuse ingestion endpoint on loopback, for the scripted run: no Langfuse server, no Docker, no network.

Langfuse SDK v4 exports every observation as OTLP spans, protobuf over HTTP, to `<LANGFUSE_BASE_URL>/api/public/otel/v1/traces`
with the public and secret key as Basic auth. This server accepts exactly that, checks the keys, decodes the spans and keeps
them for the runner to assert on. Any other path gets a 404 and is listed in `unexpected`, so a request the runner does not
know about is visible instead of silently ignored.
"""

import base64
import gzip
import json
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

TRACES_PATH = "/api/public/otel/v1/traces"


def _value(any_value: Any) -> Any:
    kind = any_value.WhichOneof("value")
    return getattr(any_value, kind) if kind else None


class FakeLangfuse:
    """Collects the spans the SDK sends. `url` goes into LANGFUSE_BASE_URL; the keys go in as given."""

    def __init__(self, public_key: str, secret_key: str) -> None:
        self.public_key = public_key
        self.secret_key = secret_key
        self.spans: list[dict[str, Any]] = []
        self.unexpected: list[str] = []
        self.unauthorised = 0
        self._lock = threading.Lock()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # the runner's stdout is data
                pass

            def _reply(self, status: int, body: bytes = b"", content_type: str = "application/json") -> None:
                self.send_response(status)
                self.send_header("content-type", content_type)
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:  # noqa: N802 - http.server's name
                length = int(self.headers.get("content-length") or 0)
                body = self.rfile.read(length)
                if self.path != TRACES_PATH:
                    owner._note(f"POST {self.path}")
                    self._reply(404, b'{"message":"not found"}')
                    return
                expected = "Basic " + base64.b64encode(f"{owner.public_key}:{owner.secret_key}".encode()).decode()
                if self.headers.get("authorization") != expected:
                    with owner._lock:
                        owner.unauthorised += 1
                    self._reply(401, b'{"message":"invalid credentials"}')
                    return
                encoding = (self.headers.get("content-encoding") or "").lower()
                if encoding == "gzip":
                    body = gzip.decompress(body)
                elif encoding == "deflate":
                    body = zlib.decompress(body)
                owner._store(ExportTraceServiceRequest.FromString(body))
                self._reply(200, b"", "application/x-protobuf")

            def do_GET(self) -> None:  # noqa: N802
                owner._note(f"GET {self.path}")
                self._reply(404, b'{"message":"not found"}')

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        self.url = f"http://127.0.0.1:{self._server.server_address[1]}"

    def _note(self, line: str) -> None:
        with self._lock:
            self.unexpected.append(line)

    def _store(self, request: ExportTraceServiceRequest) -> None:
        with self._lock:
            for resource in request.resource_spans:
                for scope in resource.scope_spans:
                    for span in scope.spans:
                        attributes = {item.key: _value(item.value) for item in span.attributes}
                        self.spans.append({"name": span.name, "scope": scope.scope.name, "attributes": attributes})

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def generations(self) -> list[dict[str, Any]]:
        """The spans Langfuse files as generations (an LLM call), in arrival order."""
        with self._lock:
            return [span for span in self.spans if span["attributes"].get("langfuse.observation.type") == "generation"]

    def usage_of(self, span: dict[str, Any]) -> dict[str, Any]:
        raw = span["attributes"].get("langfuse.observation.usage_details")
        return json.loads(raw) if isinstance(raw, str) else {}
