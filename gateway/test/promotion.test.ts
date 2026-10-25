import { describe, expect, it } from "vitest";
import type { ModelVersion } from "../src/mlflow.js";
import { decidePromotion } from "../src/promotion.js";

const v = (version: string, accuracy: number | null, status = "READY"): ModelVersion => ({
  name: "m",
  version,
  runId: "r" + version,
  status,
  aliases: [],
  accuracy,
});

describe("decidePromotion", () => {
  it("allows the first version if it meets the minimum", () => {
    expect(decidePromotion(v("1", 0.95), null).allowed).toBe(true);
  });

  it("refuses a first version below the minimum accuracy", () => {
    const d = decidePromotion(v("1", 0.5), null);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/below the minimum/);
  });

  it("allows a clear improvement and says by how much", () => {
    const d = decidePromotion(v("2", 0.97), v("1", 0.95));
    expect(d.allowed).toBe(true);
    expect(d.reason).toMatch(/0\.0200/);
  });

  it("refuses a regression", () => {
    const d = decidePromotion(v("2", 0.94), v("1", 0.95));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/at least \+0\.0010 is required/);
  });

  it("refuses an improvement smaller than the threshold (noise is not progress)", () => {
    expect(decidePromotion(v("2", 0.9505), v("1", 0.95), { minAccuracy: 0.9, minImprovement: 0.01 }).allowed).toBe(false);
  });

  it("refuses a version with no recorded accuracy", () => {
    expect(decidePromotion(v("2", null), v("1", 0.9)).allowed).toBe(false);
  });

  it("refuses a version that is not ready", () => {
    expect(decidePromotion(v("2", 0.99, "PENDING_REGISTRATION"), null).allowed).toBe(false);
  });

  it("refuses to promote what is already in production", () => {
    const d = decidePromotion(v("1", 0.95), v("1", 0.95));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/already in production/);
  });

  it("allows replacing a production version that has no recorded accuracy", () => {
    expect(decidePromotion(v("2", 0.95), v("1", null)).allowed).toBe(true);
  });
});
