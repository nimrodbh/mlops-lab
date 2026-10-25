// Thin typed client for the parts of the MLflow REST API the gateway needs.
// Response shapes were captured from a real MLflow 3.17 server (see test/fixtures).

export interface Experiment {
  id: string;
  name: string;
}

export interface Run {
  id: string;
  name: string;
  status: string;
  startTime: number;
  metrics: Record<string, number>;
  params: Record<string, string>;
}

export interface ModelVersion {
  name: string;
  version: string;
  runId: string;
  status: string;
  aliases: string[];
  accuracy: number | null; // from the "accuracy" tag written by the trainer
}

export class MlflowError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MlflowError";
  }
}

type FetchLike = typeof fetch;

interface RawKV {
  key: string;
  value: string | number;
}

const toRecord = <T extends string | number>(items: RawKV[] | undefined): Record<string, T> =>
  Object.fromEntries((items ?? []).map((kv) => [kv.key, kv.value as T]));

function toVersion(raw: any): ModelVersion {
  const tags = toRecord<string>(raw.tags);
  const acc = tags.accuracy !== undefined ? Number(tags.accuracy) : NaN;
  return {
    name: raw.name,
    version: String(raw.version),
    runId: raw.run_id ?? "",
    status: raw.status ?? "",
    aliases: raw.aliases ?? [],
    accuracy: Number.isFinite(acc) ? acc : null,
  };
}

export class MlflowClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/2.0/mlflow/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new MlflowError(0, "UNREACHABLE", `cannot reach MLflow: ${(err as Error).message}`);
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new MlflowError(res.status, json.error_code ?? "UNKNOWN", json.message ?? text);
    }
    return json;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(this.timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listExperiments(): Promise<Experiment[]> {
    const json = await this.call("POST", "experiments/search", { max_results: 100 });
    return (json.experiments ?? []).map((e: any) => ({ id: String(e.experiment_id), name: e.name }));
  }

  async searchRuns(experimentId: string, orderByMetric = "accuracy", limit = 50): Promise<Run[]> {
    const json = await this.call("POST", "runs/search", {
      experiment_ids: [experimentId],
      max_results: limit,
      order_by: [`metrics.${orderByMetric} DESC`],
    });
    return (json.runs ?? []).map((r: any) => ({
      id: r.info.run_id,
      name: r.info.run_name ?? r.info.run_id,
      status: r.info.status,
      startTime: Number(r.info.start_time),
      metrics: toRecord<number>(r.data?.metrics),
      params: toRecord<string>(r.data?.params),
    }));
  }

  async listModelNames(): Promise<string[]> {
    const json = await this.call("GET", "registered-models/search?max_results=100");
    return (json.registered_models ?? []).map((m: any) => m.name);
  }

  async listVersions(name: string): Promise<ModelVersion[]> {
    const filter = encodeURIComponent(`name='${name.replace(/'/g, "")}'`);
    const json = await this.call("GET", `model-versions/search?filter=${filter}&max_results=200`);
    return (json.model_versions ?? []).map(toVersion).sort((a: ModelVersion, b: ModelVersion) => Number(b.version) - Number(a.version));
  }

  /** The version an alias points at, or null if the alias does not exist (MLflow answers 400 for that). */
  async getAlias(name: string, alias: string): Promise<ModelVersion | null> {
    try {
      const json = await this.call(
        "GET",
        `registered-models/alias?name=${encodeURIComponent(name)}&alias=${encodeURIComponent(alias)}`,
      );
      return toVersion(json.model_version);
    } catch (err) {
      if (err instanceof MlflowError && err.status === 400 && /alias .* not found/i.test(err.message)) return null;
      throw err;
    }
  }

  async setAlias(name: string, alias: string, version: string): Promise<void> {
    await this.call("POST", "registered-models/alias", { name, alias, version });
  }
}
