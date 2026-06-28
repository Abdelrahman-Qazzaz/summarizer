import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { queryClient } from "./lib/queryClient";
import { AuthProvider } from "./hooks/auth/AuthProvider";
import { SocketProvider } from "./hooks/socket/SocketProvider";
import { ThemeProvider } from "./hooks/theme/ThemeProvider";
import { ToastProvider } from "./hooks/toast/ToastProvider";
import { Toaster } from "./components/feedback/Toaster";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <SocketProvider>
            <ToastProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
              <Toaster />
            </ToastProvider>
          </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
