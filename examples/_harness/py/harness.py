"""Runner helpers for Python examples. Same contract as examples/_harness/ts/harness.ts.

A runner calls `run_all` with one function per scenario id. The helpers mark each scenario on the capture
proxy, apply the checks in examples/_shared/scenarios.json to the observations, and print one JSON line per
result on stdout. They never write files: run.ts does that.
"""

import json
import os
import sys
import traceback
import urllib.request
from importlib import metadata
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

SCENARIOS_FILE = Path(__file__).resolve().parents[2] / "_shared" / "scenarios.json"
SCENARIOS: list[dict[str, Any]] = json.loads(SCENARIOS_FILE.read_text())["scenarios"]


def _pick(observations: Any, path: str) -> Any:
    node = observations
    for key in path.split("."):
        node = node.get(key) if isinstance(node, dict) else None
    return node


def _passes(check: dict[str, Any], value: Any) -> bool:
    if "equals" in check:
        return json.dumps(value, sort_keys=True) == json.dumps(check["equals"], sort_keys=True)
    if "containsAny" in check:
        return isinstance(value, str) and any(text.lower() in value.lower() for text in check["containsAny"])
    if check.get("present"):
        return value not in (None, "")
    if check.get("number"):
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return False


def evaluate(checks: list[dict[str, Any]], observations: dict[str, Any]) -> list[dict[str, Any]]:
    """Each check of a scenario against its observations: name and whether it held."""
    return [{"name": check["name"], "ok": _passes(check, _pick(observations, check["path"]))} for check in checks]


def mark(scenario: str, model: str, variant: Optional[str] = None) -> None:
    """Tells the capture proxy a scenario starts. The proxy waits there until earlier requests have finished."""
    url = os.environ.get("PLUGBOARD_CAPTURE_URL")
    if not url:
        raise RuntimeError("PLUGBOARD_CAPTURE_URL is not set: run this through examples/_harness/run.ts")
    payload: dict[str, Any] = {"scenario": scenario, "model": model}
    if variant is not None:
        payload["variant"] = variant
    body = json.dumps(payload).encode()
    request = urllib.request.Request(f"{url}/__mark", data=body, method="POST", headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        response.read()


def emit(line: dict[str, Any]) -> None:
    print(json.dumps(line), flush=True)


def emit_client(package: str) -> None:
    """Reports the client (its installed version, which `uv run --frozen` pins to the lockfile) and the Python runtime's major version only: the runner's minor differs between hosts, and a scripted run must not depend on the machine."""
    major = sys.version_info[0]
    emit({"kind": "client", "name": package, "version": metadata.version(package), "runtime": {"name": "python", "version": str(major)}})


def _error_text(error: BaseException) -> str:
    return f"{type(error).__name__}: {error}"


def _unobserved_for(unobserved: Mapping[str, Mapping[str, str]], scenario_id: str, variant: Optional[str]) -> dict[str, str]:
    """The checks a row leaves out: its id|variant entry, else its id entry (every variant)."""
    if variant is not None and f"{scenario_id}|{variant}" in unobserved:
        return dict(unobserved[f"{scenario_id}|{variant}"])
    return dict(unobserved.get(scenario_id, {}))


def _check_unobserved(unobserved: Mapping[str, Mapping[str, str]], planned: list[dict[str, Any]], variants: Mapping[str, list[str]]) -> None:
    """Refuses an entry that names no planned scenario or variant, a check the scenario does not have, or every check."""
    for key, names in unobserved.items():
        scenario_id, has_variant, variant = key.partition("|")
        scenario = next((candidate for candidate in planned if candidate["id"] == scenario_id), None)
        if scenario is None or (has_variant and variant not in variants.get(scenario_id, [])):
            raise ValueError(f"unobserved {key} names no planned scenario variant")
        for name in names:
            if not any(check["name"] == name for check in scenario["checks"]):
                raise ValueError(f'unobserved {key} names no check "{name}"')
        if len(names) >= len(scenario["checks"]):
            raise ValueError(f"unobserved {key} would drop every check of the row")


def run_all(
    functions: Mapping[str, Callable[..., dict[str, Any]]],
    *,
    na: Optional[Mapping[str, str]] = None,
    gaps: Optional[Mapping[str, Mapping[str, str]]] = None,
    variants: Optional[Mapping[str, list[str]]] = None,
    unobserved: Optional[Mapping[str, Mapping[str, str]]] = None,
) -> None:
    """Runs every scenario the runner covers, on each of its models, in file order.

    A function gets the model, and the variant as a second argument when the scenario has variants (`variants` maps an id
    to the APIs it runs on, e.g. {"S1": ["chat", "messages"]}).
    `gaps` maps `id`, `id|model` or `id|variant` to {"note", "issue"}: a failure there is reported as `gap`. A gap
    covers the whole row, so its note should name the known check.
    `na` maps an id to the reason the client does not have it: reported as `n/a`, nothing is sent.
    `unobserved` maps `id` (every model and variant) or `id|variant` to {check name: reason}: such a check is left out of
    its row and the note names it, so the row passes on what the client exposes (#370). It must name a planned check, and
    may not drop every check of its row.
    """
    na = dict(na or {})
    variants = dict(variants or {})
    planned = [scenario for scenario in SCENARIOS if scenario["id"] in functions or scenario["id"] in na]
    _check_unobserved(unobserved or {}, planned, variants)
    emit({"kind": "plan", "scenarios": [scenario["id"] for scenario in planned]})
    for scenario in planned:
        for model in scenario["models"]:
            for variant in variants.get(scenario["id"], [None]):
                tag = {} if variant is None else {"variant": variant}
                if scenario["id"] in na:
                    emit({"kind": "result", "scenario": scenario["id"], "model": model, **tag, "status": "n/a", "checks": [], "error": None, "note": na[scenario["id"]]})
                    continue
                mark(scenario["id"], model, variant)
                checks: list[dict[str, Any]] = []
                error: Optional[str] = None
                observations: dict[str, Any] = {}
                skipped = _unobserved_for(unobserved or {}, scenario["id"], variant)
                kept = [check for check in scenario["checks"] if check["name"] not in skipped]
                try:
                    call = functions[scenario["id"]]
                    observations = call(model) if variant is None else call(model, variant)
                    checks = evaluate(kept, observations)
                except Exception as caught:  # noqa: BLE001 - the error text is the result
                    traceback.print_exc(file=sys.stderr)
                    error = _error_text(caught)
                status = "pass" if error is None and all(check["ok"] for check in checks) else "fail"
                note: Optional[str] = None
                gap = (
                    (gaps or {}).get(f"{scenario['id']}|{model}")
                    or ((gaps or {}).get(f"{scenario['id']}|{variant}") if variant is not None else None)
                    or (gaps or {}).get(scenario["id"])
                )
                if status == "fail" and gap:
                    status = "gap"
                    note = f"{gap['note']} ({gap['issue']})"
                if note is None and skipped:
                    note = "; ".join(f"not checked, {name}: {why}" for name, why in skipped.items())
                emit({"kind": "result", "scenario": scenario["id"], "model": model, **tag, "status": status, "checks": checks, "error": error, "note": note, "observations": observations})
    emit({"kind": "done"})
