import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@png2cad/ui/fonts.css";
import "@png2cad/ui/tokens.css";
import "./app.css";
import { App } from "./App";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
