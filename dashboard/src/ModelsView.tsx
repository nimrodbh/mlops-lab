import { useCallback, useEffect, useState } from "react";
import { listModels, promote, type Model } from "./api";

export function ModelsView() {
  const [models, setModels] = useState<Model[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listModels()
      .then(setModels)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function onPromote(name: string, version: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await promote(name, version);
      setMessage({ ok: result.promoted, text: `${name} v${version}: ${result.promoted ? "promoted" : "refused"}. ${result.reason}.` });
      if (result.promoted) load();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p role="alert">Could not load models: {error}</p>;
  if (models === null) return <p>Loading models...</p>;
  if (models.length === 0) return <p>No registered models yet.</p>;

  return (
    <section>
      <p role="status" className={message ? (message.ok ? "ok" : "warn") : undefined}>
        {message?.text ?? "A version is served only if it passes the promotion gate."}
      </p>
      {models.map((m) => (
        <div key={m.name}>
          <h2>{m.name}</h2>
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Accuracy</th>
                <th>Status</th>
                <th>Serving</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {m.versions.map((v) => {
                const isProd = m.production === v.version;
                return (
                  <tr key={v.version}>
                    <td>v{v.version}</td>
                    <td>{v.accuracy === null ? "-" : v.accuracy.toFixed(3)}</td>
                    <td>{v.status}</td>
                    <td>{isProd ? "production" : ""}</td>
                    <td>
                      <button disabled={busy || isProd} onClick={() => onPromote(m.name, v.version)} aria-label={`Promote ${m.name} version ${v.version}`}>
                        Promote
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
