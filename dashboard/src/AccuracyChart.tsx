import type { Run } from "./api";

/** Horizontal bars of accuracy per run. The axis starts at the worst run so small differences are visible. */
export function AccuracyChart({ runs }: { runs: Run[] }) {
  const scored = runs.filter((r) => typeof r.metrics.accuracy === "number");
  if (scored.length === 0) return null;
  const values = scored.map((r) => r.metrics.accuracy);
  const lo = Math.min(...values) - 0.01;
  const hi = Math.max(...values);
  const width = (v: number) => (hi === lo ? 100 : ((v - lo) / (hi - lo)) * 100);
  return (
    <figure className="chart" aria-label="Accuracy per run">
      {scored.map((r) => (
        <div className="bar-row" key={r.id}>
          <span className="bar-label">{r.name}</span>
          <svg className="bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label={`${r.name} accuracy ${r.metrics.accuracy.toFixed(3)}`}>
            <rect x="0" y="0" width={width(r.metrics.accuracy)} height="8" />
          </svg>
          <span className="bar-value">{r.metrics.accuracy.toFixed(3)}</span>
        </div>
      ))}
      <figcaption>Axis starts at {lo.toFixed(3)}</figcaption>
    </figure>
  );
}
