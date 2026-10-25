import { createApp } from "./app.js";
import { MlflowClient } from "./mlflow.js";
import { DEFAULT_GATE } from "./promotion.js";

const mlflowUrl = (process.env.MLFLOW_URL ?? "http://localhost:5000").replace(/\/$/, "");
const port = Number(process.env.PORT ?? 3001);
const gate = {
  minAccuracy: Number(process.env.GATE_MIN_ACCURACY ?? DEFAULT_GATE.minAccuracy),
  minImprovement: Number(process.env.GATE_MIN_IMPROVEMENT ?? DEFAULT_GATE.minImprovement),
};

const server = createApp(new MlflowClient(mlflowUrl), gate).listen(port, () => {
  console.log(`gateway on :${port}, MLflow at ${mlflowUrl}, gate ${JSON.stringify(gate)}`);
});

// Kubernetes sends SIGTERM on rollout; finish in-flight requests, then exit.
process.on("SIGTERM", () => server.close(() => process.exit(0)));
