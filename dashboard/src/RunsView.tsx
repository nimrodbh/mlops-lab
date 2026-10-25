import { useEffect, useState } from "react";
import { AccuracyChart } from "./AccuracyChart";
import { listExperiments, listRuns, type Experiment, type Run } from "./api";

const fmt = (v: number | undefined) => (v === undefined ? "-" : v.toFixed(3));

export function RunsView() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listExperiments()
      .then((exps) => {
        const real = exps.filter((e) => e.name !== "Default");
        setExperiments(real);
        setSelected(real[0]?.id ?? "");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setError(null);
    setRuns(null);
    listRuns(selected)
      .then(setRuns)
      .catch((e: Error) => setError(e.message));
  }, [selected]);

  if (loading) return <p>Loading experiments...</p>;
  if (error) return <p role="alert">Could not load runs: {error}</p>;
  if (experiments.length === 0) return <p>No experiments yet. Run the trainer to create one.</p>;

  return (
    <section>
      <label>
        Experiment{" "}
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {experiments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      {runs === null ? (
        <p>Loading runs...</p>
      ) : (
        <RunsTable runs={runs} />
      )}
    </section>
  );
}

function RunsTable({ runs }: { runs: Run[] }) {
  return (
    <>
      <AccuracyChart runs={runs} />
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Model</th>
            <th>Accuracy</th>
            <th>F1</th>
            <th>Train acc.</th>
            <th>Overfit gap</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const gap = r.metrics.train_accuracy !== undefined && r.metrics.accuracy !== undefined ? r.metrics.train_accuracy - r.metrics.accuracy : undefined;
            return (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.params.model ?? "-"}</td>
                <td>{fmt(r.metrics.accuracy)}</td>
                <td>{fmt(r.metrics.f1_macro)}</td>
                <td>{fmt(r.metrics.train_accuracy)}</td>
                <td className={gap !== undefined && gap > 0.05 ? "warn" : undefined}>{fmt(gap)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
