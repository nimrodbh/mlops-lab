import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

const run = (id: string, name: string, accuracy: number, train = 0.99) => ({
  id,
  name,
  status: "FINISHED",
  startTime: 1,
  metrics: { accuracy, f1_macro: accuracy - 0.001, train_accuracy: train },
  params: { model: "logreg" },
});

function modelsBody(production: string | null) {
  return {
    models: [
      {
        name: "digits-classifier",
        production,
        versions: [
          { name: "digits-classifier", version: "2", runId: "b", status: "READY", aliases: production === "2" ? ["production"] : [], accuracy: 0.976 },
          { name: "digits-classifier", version: "1", runId: "a", status: "READY", aliases: production === "1" ? ["production"] : [], accuracy: 0.963 },
        ],
      },
    ],
  };
}

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };

function mockFetch(handler: Handler) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const r = handler(url, init);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});
afterEach(cleanup);

describe("Runs tab", () => {
  it("shows the runs of the first experiment, hiding MLflow's Default experiment", async () => {
    mockFetch((url) => {
      if (url === "/api/experiments") return { body: { experiments: [{ id: "0", name: "Default" }, { id: "1", name: "digits" }] } };
      if (url.startsWith("/api/experiments/1/runs")) return { body: { runs: [run("a", "forest-100", 0.975), run("b", "logreg-0.001", 0.963, 0.97)] } };
      return { status: 404, body: {} };
    });
    render(<App />);
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("forest-100")).toBeTruthy();
    expect(screen.getAllByRole("img", { name: /forest-100 accuracy 0\.975/ })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "digits" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Default" })).toBeNull();
    expect(table.getByText("0.975")).toBeTruthy();
  });

  it("flags a large gap between training and test accuracy", async () => {
    mockFetch((url) =>
      url === "/api/experiments"
        ? { body: { experiments: [{ id: "1", name: "digits" }] } }
        : { body: { runs: [run("a", "overfit", 0.8, 1.0), run("b", "fine", 0.95, 0.96)] } },
    );
    render(<App />);
    const table = within(await screen.findByRole("table"));
    expect(within(table.getByText("overfit").closest("tr")!).getByText("0.200").className).toBe("warn");
    expect(within(table.getByText("fine").closest("tr")!).getByText("0.010").className).toBe("");
  });

  it("shows an empty state and an error state", async () => {
    mockFetch(() => ({ body: { experiments: [] } }));
    render(<App />);
    expect(await screen.findByText(/No experiments yet/)).toBeTruthy();
    cleanup();

    mockFetch(() => ({ status: 502, body: { error: "MLflow request failed" } }));
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain("MLflow request failed");
  });
});

describe("tabs", () => {
  it("opens the tab named in the URL hash and records the choice", async () => {
    mockFetch((url) => (url === "/api/models" ? { body: { models: [] } } : { body: { experiments: [] } }));
    window.location.hash = "#models";
    render(<App />);
    expect(await screen.findByText(/No registered models/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Runs" }));
    expect(window.location.hash).toBe("#runs");
  });
});

describe("Models tab", () => {
  const openModels = async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Models" }));
  };

  it("promotes a version and then shows it as serving", async () => {
    let production: string | null = "1";
    const calls = mockFetch((url, init) => {
      if (url === "/api/experiments") return { body: { experiments: [] } };
      if (url === "/api/models") return { body: modelsBody(production) };
      if (init?.method === "POST") {
        production = "2";
        return { body: { promoted: true, reason: "improves accuracy by 0.0130 over version 1" } };
      }
      return { status: 404, body: {} };
    });
    await openModels();
    await userEvent.click(await screen.findByRole("button", { name: "Promote digits-classifier version 2" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("promoted"));
    expect(calls).toContain("POST /api/models/digits-classifier/versions/2/promote");
    await waitFor(() => expect(within(screen.getByText("v2").closest("tr")!).getByText("production")).toBeTruthy());
  });

  it("shows the gate's reason when a promotion is refused (HTTP 409)", async () => {
    mockFetch((url, init) => {
      if (url === "/api/experiments") return { body: { experiments: [] } };
      if (url === "/api/models") return { body: modelsBody("2") };
      if (init?.method === "POST") return { status: 409, body: { promoted: false, reason: "improves accuracy by -0.0130, less than the required 0.0010 over version 2" } };
      return { status: 404, body: {} };
    });
    await openModels();
    await userEvent.click(await screen.findByRole("button", { name: "Promote digits-classifier version 1" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("refused"));
    expect(screen.getByRole("status").className).toBe("warn");
  });

  it("says it is loading, and only then claims there are no models", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/models") await gate;
        return new Response(JSON.stringify(url === "/api/models" ? { models: [] } : { experiments: [] }));
      }),
    );
    await openModels();
    expect(screen.getByText("Loading models...")).toBeTruthy();
    expect(screen.queryByText(/No registered models/)).toBeNull();
    release();
    expect(await screen.findByText(/No registered models/)).toBeTruthy();
  });

  it("disables the button for the version already in production", async () => {
    mockFetch((url) => (url === "/api/experiments" ? { body: { experiments: [] } } : { body: modelsBody("2") }));
    await openModels();
    const btn = (await screen.findByRole("button", { name: "Promote digits-classifier version 2" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
