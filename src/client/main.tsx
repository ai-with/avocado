import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/base.css";
import { router } from "./routes";
import { MeProvider } from "./lib/me";
import { ToastProvider } from "./ui";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </MeProvider>
  </StrictMode>,
);
