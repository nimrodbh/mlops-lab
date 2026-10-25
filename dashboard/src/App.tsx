import { useState } from "react";
import { ModelsView } from "./ModelsView";
import { RunsView } from "./RunsView";

type Tab = "runs" | "models";
const fromHash = (): Tab => (window.location.hash === "#models" ? "models" : "runs");

export function App() {
  const [tab, setTab] = useState<Tab>(fromHash);
  const choose = (t: Tab) => {
    window.location.hash = t;
    setTab(t);
  };
  return (
    <main>
      <h1>mlops-lab</h1>
      <nav>
        <button aria-pressed={tab === "runs"} onClick={() => choose("runs")}>
          Runs
        </button>
        <button aria-pressed={tab === "models"} onClick={() => choose("models")}>
          Models
        </button>
      </nav>
      {tab === "runs" ? <RunsView /> : <ModelsView />}
    </main>
  );
}
