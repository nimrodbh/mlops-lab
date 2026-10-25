import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MlflowError, type ModelVersion } from "../src/mlflow.js";

const ver = (version: string, accuracy: number | null, aliases: string[] = []): ModelVersion => ({
  name: "digits-classifier",
  version,
  runId: "run" + version,
  status: "READY",
  aliases,
  accuracy,
});

/** In-memory stand-in for MLflow with the same behavior the gateway relies on. */
class FakeApi {
  versions: ModelVersion[] = [ver("1", 0.95, ["production"]), ver("2", 0.97), ver("3", 0.94)];
  alias: Record<string, string> = { production: "1" };
  up = true;
  failWith: MlflowError | null = null;
  setCalls: string[][] = [];

  async ping() {
    return this.up;
  }
  async listExperiments() {
    if (this.failWith) throw this.failWith;
    return [{ id: "1", name: "digits" }];
  }
  async searchRuns(id: string, orderBy: string, limit: number) {
    return [{ id: "r", name: `${id}-${orderBy}-${limit}`, status: "FINISHED", startTime: 1, metrics: { accuracy: 0.9 }, params: {} }];
  }
  async listModelNames() {
    return ["digits-classifier"];
  }
  async listVersions(_name: string) {
    return [...this.versions].reverse();
  }
  async getAlias(_name: string, alias: string) {
    const v = this.alias[alias];
    return v ? (this.versions.find((x) => x.version === v) ?? null) : null;
  }
  async setAlias(name: string, alias: string, version: string) {
    this.setCalls.push([name, alias, version]);
    this.alias[alias] = version;
  }
}

let api: FakeApi;
beforeEach(() => {
  api = new FakeApi();
});
const app = () => createApp(api as never);

describe("health", () => {
  it("is 200 when MLflow is reachable and 503 when not", async () => {
    expect((await request(app()).get("/health")).status).toBe(200);
    api.up = false;
    const res = await request(app()).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "degraded", mlflow: false });
  });
});

describe("read endpoints", () => {
  it("lists experiments", async () => {
    const res = await request(app()).get("/api/experiments");
    expect(res.body.experiments[0].name).toBe("digits");
  });

  it("passes validated query options to the run search", async () => {
    const res = await request(app()).get("/api/experiments/7/runs?orderBy=f1_macro&limit=5");
    expect(res.body.runs[0].name).toBe("7-f1_macro-5");
  });

  it.each(["/api/experiments/abc/runs", "/api/experiments/1/runs?limit=0", "/api/experiments/1/runs?limit=9999", "/api/experiments/1/runs?orderBy=a%20b"])(
    "rejects bad input: %s",
    async (path) => {
      expect((await request(app()).get(path)).status).toBe(400);
    },
  );

  it("lists models with versions and the production version", async () => {
    const res = await request(app()).get("/api/models");
    expect(res.body.models[0].production).toBe("1");
    expect(res.body.models[0].versions).toHaveLength(3);
    expect(res.body.gate.minAccuracy).toBeGreaterThan(0);
  });
});

describe("promotion", () => {
  const promote = (v: string, name = "digits-classifier") => request(app()).post(`/api/models/${name}/versions/${v}/promote`);

  it("promotes a better version and moves the alias", async () => {
    const res = await promote("2");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ promoted: true, previous: "1" });
    expect(api.setCalls).toEqual([["digits-classifier", "production", "2"]]);
  });

  it("refuses a worse version with 409 and a reason, and does not touch the alias", async () => {
    const res = await promote("3");
    expect(res.status).toBe(409);
    expect(res.body.promoted).toBe(false);
    expect(res.body.reason).toMatch(/at least \+0\.0010 is required/);
    expect(api.setCalls).toHaveLength(0);
  });

  it("refuses the version already in production", async () => {
    expect((await promote("1")).status).toBe(409);
  });

  it("promotes the first version when nothing is in production", async () => {
    api.alias = {};
    expect((await promote("2")).status).toBe(200);
  });

  it("404s on an unknown version and 400s on malformed input", async () => {
    expect((await promote("99")).status).toBe(404);
    expect((await promote("x1")).status).toBe(400);
    expect((await promote("2", "bad%20name")).status).toBe(400);
    expect(api.setCalls).toHaveLength(0);
  });
});

describe("errors", () => {
  it("reports an MLflow failure as 502 without crashing", async () => {
    api.failWith = new MlflowError(0, "UNREACHABLE", "cannot reach MLflow");
    const res = await request(app()).get("/api/experiments");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("MLflow request failed");
  });

  it("hides the details of unexpected errors", async () => {
    api.listExperiments = async () => {
      throw new Error("secret internals");
    };
    const res = await request(app()).get("/api/experiments");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
});
