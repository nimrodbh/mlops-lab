"""Train a few small classifiers, log every run to MLflow, and register the best one.

Each invocation is one "sweep": several runs in one experiment. The best run by test accuracy is
registered as a new version of the model, and the gateway decides separately whether that version
is good enough to serve (the promotion gate). Training never promotes anything by itself.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass

import mlflow
import mlflow.sklearn
from mlflow.tracking import MlflowClient
from sklearn.datasets import load_digits
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split

MODEL_NAME = "digits-classifier"

# MLflow serializes sklearn models with skops and refuses types it cannot vouch for. Tree storage
# (inside every forest) is one of them. We train these models ourselves, so we trust exactly that type.
TRUSTED_TYPES = ["sklearn.tree._tree.Tree"]


@dataclass(frozen=True)
class Candidate:
    name: str
    params: dict

    def build(self, seed: int):
        if self.name == "logreg":
            return LogisticRegression(max_iter=2000, random_state=seed, **self.params)
        if self.name == "forest":
            return RandomForestClassifier(random_state=seed, n_jobs=1, **self.params)
        raise ValueError(f"unknown model {self.name}")


def candidates(n: int) -> list[Candidate]:
    """A deterministic list of candidates: a sweep over regularization, then forest size."""
    pool: list[Candidate] = []
    for c in (0.001, 0.01, 0.1, 1.0, 10.0):
        pool.append(Candidate("logreg", {"C": c}))
    for trees in (5, 20, 100):
        pool.append(Candidate("forest", {"n_estimators": trees, "max_depth": 8}))
    return pool[:n]


def run_sweep(
    experiment: str, n_runs: int, seed: int = 0, register: bool = True, pool: list[Candidate] | None = None
) -> dict:
    X, y = load_digits(return_X_y=True)
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.3, random_state=seed, stratify=y)

    mlflow.set_experiment(experiment)
    best: tuple[float, str] | None = None
    for cand in pool if pool is not None else candidates(n_runs):
        with mlflow.start_run(run_name=f"{cand.name}-{'-'.join(str(v) for v in cand.params.values())}") as run:
            model = cand.build(seed).fit(X_tr, y_tr)
            pred = model.predict(X_te)
            acc = float(accuracy_score(y_te, pred))
            mlflow.log_param("model", cand.name)
            mlflow.log_params(cand.params)
            mlflow.log_param("seed", seed)
            mlflow.log_metric("accuracy", acc)
            mlflow.log_metric("f1_macro", float(f1_score(y_te, pred, average="macro")))
            mlflow.log_metric("train_accuracy", float(accuracy_score(y_tr, model.predict(X_tr))))
            mlflow.sklearn.log_model(model, name="model", skops_trusted_types=TRUSTED_TYPES)
            if best is None or acc > best[0]:
                best = (acc, run.info.run_id)

    result = {"best_accuracy": best[0], "best_run_id": best[1], "version": None}
    if register and best is not None:
        mv = mlflow.register_model(f"runs:/{best[1]}/model", MODEL_NAME)
        MlflowClient().set_model_version_tag(MODEL_NAME, mv.version, "accuracy", f"{best[0]:.6f}")
        result["version"] = mv.version
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--experiment", default="digits")
    ap.add_argument("--runs", type=int, default=8)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--tracking-uri", default=os.environ.get("MLFLOW_TRACKING_URI", "http://localhost:5000"))
    args = ap.parse_args()
    mlflow.set_tracking_uri(args.tracking_uri)
    out = run_sweep(args.experiment, args.runs, args.seed)
    print(f"best accuracy {out['best_accuracy']:.4f} (run {out['best_run_id']}), registered version {out['version']}")


if __name__ == "__main__":
    main()
