import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import "./pages.css";
import "./features.css";
import "./protection.css";
import { App } from "./App";

// Screenshot mode renders in a hidden window that paints no frames, so entrance animations are skipped.
if (window.cleanerWindow?.capture) document.documentElement.dataset.capture = "";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
