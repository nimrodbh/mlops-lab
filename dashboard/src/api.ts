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
  accuracy: number | null;
}

export interface Model {
  name: string;
  versions: ModelVersion[];
  production: string | null;
}

export interface PromoteResult {
  promoted: boolean;
  reason: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

async function getJson<T>(path: string): Promise<T> {
  const { status, body } = await request<T & { error?: string }>(path);
  if (status >= 400) throw new Error((body as { error?: string }).error ?? `request failed (${status})`);
  return body;
}

export const listExperiments = async () => (await getJson<{ experiments: Experiment[] }>("/api/experiments")).experiments;

export const listRuns = async (experimentId: string) =>
  (await getJson<{ runs: Run[] }>(`/api/experiments/${encodeURIComponent(experimentId)}/runs?orderBy=accuracy`)).runs;

export const listModels = async () => (await getJson<{ models: Model[] }>("/api/models")).models;

/** A refusal by the promotion gate (HTTP 409) is an answer, not an error. */
export async function promote(name: string, version: string): Promise<PromoteResult> {
  const { status, body } = await request<PromoteResult & { error?: string }>(
    `/api/models/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/promote`,
    { method: "POST" },
  );
  if (status === 200 || status === 409) return { promoted: body.promoted, reason: body.reason };
  throw new Error(body.error ?? `request failed (${status})`);
}
