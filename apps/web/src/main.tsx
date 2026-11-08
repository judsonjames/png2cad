import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@png2cad/ui/fonts.css";
import "@png2cad/ui/tokens.css";
import "./app.css";
import { App } from "./App";

// Keeps the app's files so it opens offline once installed. Not during development, where files keep changing.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error: unknown) => {
      console.warn("The app will not open offline:", error);
    });
  });
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
