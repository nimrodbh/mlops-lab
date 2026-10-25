import type { ModelVersion } from "./mlflow.js";

export interface GateConfig {
  /** A model must reach at least this accuracy to be served at all. */
  minAccuracy: number;
  /** A new version must beat the current production version by at least this much. */
  minImprovement: number;
}

export const DEFAULT_GATE: GateConfig = { minAccuracy: 0.9, minImprovement: 0.001 };

export interface Decision {
  allowed: boolean;
  reason: string;
}

/** Pure decision: may `candidate` replace `production` as the served version? */
export function decidePromotion(
  candidate: ModelVersion,
  production: ModelVersion | null,
  gate: GateConfig = DEFAULT_GATE,
): Decision {
  if (candidate.status !== "READY") {
    return { allowed: false, reason: `version ${candidate.version} is not ready (status ${candidate.status})` };
  }
  if (candidate.accuracy === null) {
    return { allowed: false, reason: `version ${candidate.version} has no accuracy recorded, so it cannot be judged` };
  }
  if (production && production.version === candidate.version) {
    return { allowed: false, reason: `version ${candidate.version} is already in production` };
  }
  if (candidate.accuracy < gate.minAccuracy) {
    return {
      allowed: false,
      reason: `accuracy ${candidate.accuracy.toFixed(4)} is below the minimum ${gate.minAccuracy.toFixed(4)}`,
    };
  }
  if (!production) {
    return { allowed: true, reason: "first production version, and it meets the minimum accuracy" };
  }
  if (production.accuracy === null) {
    return { allowed: true, reason: "current production version has no recorded accuracy" };
  }
  const gain = candidate.accuracy - production.accuracy;
  if (gain < gate.minImprovement) {
    const signed = `${gain >= 0 ? "+" : ""}${gain.toFixed(4)}`;
    return {
      allowed: false,
      reason: `accuracy changes by ${signed} against version ${production.version}, but at least +${gate.minImprovement.toFixed(4)} is required`,
    };
  }
  return { allowed: true, reason: `improves accuracy by ${gain.toFixed(4)} over version ${production.version}` };
}
