"""End-to-end check of a running stack (compose or Kubernetes), using only the standard library.

Expects the trainer to have run twice with the same seed, so MLflow holds two versions of the
model with identical accuracy. Usage: python scripts/smoke.py http://localhost:8080
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


def call(base: str, path: str, method: str = "GET") -> tuple[int, dict]:
    req = urllib.request.Request(base + path, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def check(cond: bool, label: str) -> None:
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        sys.exit(1)


def main(base: str) -> None:
    status, body = call(base, "/api/experiments")
    check(status == 200 and any(e["name"] == "digits" for e in body["experiments"]), "experiment 'digits' exists")

    exp = next(e for e in body["experiments"] if e["name"] == "digits")
    status, body = call(base, f"/api/experiments/{exp['id']}/runs?orderBy=accuracy")
    runs = body["runs"]
    check(status == 200 and len(runs) >= 8, f"runs listed ({len(runs)})")
    accs = [r["metrics"]["accuracy"] for r in runs]
    check(accs == sorted(accs, reverse=True), "runs come back ordered by accuracy")

    status, body = call(base, "/api/models")
    model = body["models"][0]
    versions = sorted(int(v["version"]) for v in model["versions"])
    check(status == 200 and len(versions) >= 2, f"two model versions registered ({versions})")
    check(model["production"] is None, "nothing in production yet")
    first, second = str(versions[0]), str(versions[1])
    name = model["name"]

    status, body = call(base, f"/api/models/{name}/versions/{first}/promote", "POST")
    check(status == 200 and body["promoted"], f"first version promoted: {body.get('reason')}")

    status, body = call(base, f"/api/models/{name}/versions/{second}/promote", "POST")
    check(status == 409 and not body["promoted"], f"identical-accuracy version refused: {body.get('reason')}")

    status, body = call(base, f"/api/models/{name}/versions/{first}/promote", "POST")
    check(status == 409 and "already in production" in body["reason"], "re-promoting production refused")

    status, body = call(base, "/api/models")
    check(body["models"][0]["production"] == first, "production alias still points at the first version")
    print("smoke test passed")


if __name__ == "__main__":
    main(sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8080")
