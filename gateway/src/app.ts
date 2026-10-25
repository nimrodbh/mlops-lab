import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { MlflowError, type MlflowClient, type ModelVersion } from "./mlflow.js";
import { DEFAULT_GATE, decidePromotion, type GateConfig } from "./promotion.js";

export const PRODUCTION_ALIAS = "production";

type Api = Pick<
  MlflowClient,
  "ping" | "listExperiments" | "searchRuns" | "listModelNames" | "listVersions" | "getAlias" | "setAlias"
>;

const runsQuery = z.object({
  orderBy: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).default("accuracy"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const idParam = z.string().regex(/^[0-9]{1,12}$/);
const nameParam = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const versionParam = z.string().regex(/^[0-9]{1,9}$/);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export function createApp(api: Api, gate: GateConfig = DEFAULT_GATE) {
  const app = express();
  app.use(express.json({ limit: "10kb" }));

  app.get(
    "/health",
    wrap(async (_req, res) => {
      const mlflow = await api.ping();
      res.status(mlflow ? 200 : 503).json({ status: mlflow ? "ok" : "degraded", mlflow });
    }),
  );

  app.get(
    "/api/experiments",
    wrap(async (_req, res) => {
      res.json({ experiments: await api.listExperiments() });
    }),
  );

  app.get(
    "/api/experiments/:id/runs",
    wrap(async (req, res) => {
      const id = idParam.safeParse(req.params.id);
      const q = runsQuery.safeParse(req.query);
      if (!id.success || !q.success) throw new HttpError(400, "invalid experiment id or query");
      res.json({ runs: await api.searchRuns(id.data, q.data.orderBy, q.data.limit) });
    }),
  );

  app.get(
    "/api/models",
    wrap(async (_req, res) => {
      const names = await api.listModelNames();
      const models = await Promise.all(
        names.map(async (name) => ({
          name,
          versions: await api.listVersions(name),
          production: (await api.getAlias(name, PRODUCTION_ALIAS))?.version ?? null,
        })),
      );
      res.json({ models, gate });
    }),
  );

  app.post(
    "/api/models/:name/versions/:version/promote",
    wrap(async (req, res) => {
      const name = nameParam.safeParse(req.params.name);
      const version = versionParam.safeParse(req.params.version);
      if (!name.success || !version.success) throw new HttpError(400, "invalid model name or version");

      const versions = await api.listVersions(name.data);
      const candidate: ModelVersion | undefined = versions.find((v) => v.version === version.data);
      if (!candidate) throw new HttpError(404, `${name.data} has no version ${version.data}`);

      const production = await api.getAlias(name.data, PRODUCTION_ALIAS);
      const decision = decidePromotion(candidate, production, gate);
      if (!decision.allowed) {
        res.status(409).json({ promoted: false, reason: decision.reason });
        return;
      }
      await api.setAlias(name.data, PRODUCTION_ALIAS, candidate.version);
      res.json({ promoted: true, reason: decision.reason, previous: production?.version ?? null });
    }),
  );

  // Errors: our own HttpError, MLflow failures (bad gateway), anything else (500, details hidden).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else if (err instanceof MlflowError) {
      res.status(502).json({ error: "MLflow request failed", detail: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  });

  return app;
}
