import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MlflowClient, MlflowError } from "../src/mlflow.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** A fetch that answers from canned responses keyed by "METHOD path-prefix" and records what it was asked. */
function stub(routes: Record<string, { status?: number; body: string }>) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    const key = Object.keys(routes).find((k) => `${method} ${url}`.includes(k));
    if (!key) throw new Error(`unexpected request ${method} ${url}`);
    const r = routes[key];
    return new Response(r.body, { status: r.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("MlflowClient against real MLflow responses", () => {
  it("lists experiments", async () => {
    const { impl } = stub({ "POST http://m/api/2.0/mlflow/experiments/search": { body: fixture("experiments.json") } });
    const exps = await new MlflowClient("http://m", impl).listExperiments();
    expect(exps.map((e) => e.name)).toContain("digits");
    expect(typeof exps[0].id).toBe("string");
  });

  it("flattens runs into metric and param records and asks for the right ordering", async () => {
    const { impl, calls } = stub({ "runs/search": { body: fixture("runs.json") } });
    const runs = await new MlflowClient("http://m", impl).searchRuns("1", "accuracy", 3);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].metrics.accuracy).toBeGreaterThan(0.9);
    expect(runs[0].params.model).toBeTruthy();
    expect(JSON.parse(calls[0].body!)).toMatchObject({ experiment_ids: ["1"], order_by: ["metrics.accuracy DESC"] });
  });

  it("reads versions with accuracy from the tag, newest first", async () => {
    const { impl } = stub({ "model-versions/search": { body: fixture("versions.json") } });
    const versions = await new MlflowClient("http://m", impl).listVersions("digits-classifier");
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0].accuracy).toBeGreaterThan(0.9);
    const nums = versions.map((x) => Number(x.version));
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
  });

  it("returns the version an alias points at", async () => {
    const { impl } = stub({ "registered-models/alias": { body: fixture("alias.json") } });
    const mv = await new MlflowClient("http://m", impl).getAlias("digits-classifier", "production");
    expect(mv?.aliases).toContain("production");
  });

  it("turns MLflow's 400 'alias not found' into null, but not other 400s", async () => {
    const missing = stub({ "registered-models/alias": { status: 400, body: fixture("alias-missing.json") } });
    expect(await new MlflowClient("http://m", missing.impl).getAlias("m", "nope")).toBeNull();

    const other = stub({
      "registered-models/alias": { status: 400, body: JSON.stringify({ error_code: "INVALID_PARAMETER_VALUE", message: "bad name" }) },
    });
    await expect(new MlflowClient("http://m", other.impl).getAlias("m", "x")).rejects.toBeInstanceOf(MlflowError);
  });

  it("wraps network failures as MlflowError UNREACHABLE", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(new MlflowClient("http://m", down).listExperiments()).rejects.toMatchObject({ code: "UNREACHABLE" });
    expect(await new MlflowClient("http://m", down).ping()).toBe(false);
  });

  it("strips quotes from model names before building the search filter", async () => {
    const { impl, calls } = stub({ "model-versions/search": { body: "{}" } });
    await new MlflowClient("http://m", impl).listVersions("a'b");
    expect(decodeURIComponent(calls[0].url)).toContain("name='ab'");
  });
});
