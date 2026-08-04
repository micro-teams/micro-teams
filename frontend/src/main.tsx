import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { startLineManagement } from "@/lib/lines";

// Started, not awaited. The app has a line to use from the first render — the one it is already
// being served over — so making startup wait on a routing table would add a round trip to every
// cold start in exchange for nothing.
void startLineManagement();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
