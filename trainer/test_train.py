import mlflow
import mlflow.sklearn
import pytest
import train
from mlflow.tracking import MlflowClient


@pytest.fixture()
def tracking(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # default artifact root is ./mlruns, keep it inside the temp dir
    uri = f"sqlite:///{tmp_path / 'mlflow.db'}"
    mlflow.set_tracking_uri(uri)
    mlflow.set_registry_uri(uri)
    yield uri


def test_candidates_are_deterministic_and_bounded():
    assert [c.name for c in train.candidates(3)] == ["logreg"] * 3
    assert len(train.candidates(100)) == 8
    assert train.candidates(8) == train.candidates(8)


def test_unknown_model_is_rejected():
    with pytest.raises(ValueError):
        train.Candidate("svm", {}).build(0)


def test_sweep_logs_runs_and_registers_best(tracking):
    out = train.run_sweep("t-digits", n_runs=3, seed=1)
    client = MlflowClient()
    exp = client.get_experiment_by_name("t-digits")
    runs = client.search_runs([exp.experiment_id])
    assert len(runs) == 3
    best = max(r.data.metrics["accuracy"] for r in runs)
    assert out["best_accuracy"] == pytest.approx(best)
    mv = client.get_model_version(train.MODEL_NAME, out["version"])
    assert mv.run_id == out["best_run_id"]
    assert float(mv.tags["accuracy"]) == pytest.approx(best, abs=1e-6)


def test_same_seed_gives_same_accuracy(tracking):
    a = train.run_sweep("t-a", n_runs=2, seed=3, register=False)
    b = train.run_sweep("t-b", n_runs=2, seed=3, register=False)
    assert a["best_accuracy"] == b["best_accuracy"]


def test_repeated_sweeps_create_new_versions(tracking):
    v1 = train.run_sweep("t-v", n_runs=1, seed=0)["version"]
    v2 = train.run_sweep("t-v", n_runs=1, seed=0)["version"]
    assert int(v2) == int(v1) + 1


def test_forest_model_can_be_logged_and_loaded(tracking):
    forest = [c for c in train.candidates(8) if c.name == "forest"][:1]
    out = train.run_sweep("t-forest", n_runs=1, pool=forest)
    model = mlflow.sklearn.load_model(f"runs:/{out['best_run_id']}/model")
    assert model.predict(train.load_digits(return_X_y=True)[0][:5]).shape == (5,)
