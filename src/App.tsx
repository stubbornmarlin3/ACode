import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";
import { RootLayout } from "./components/layout/RootLayout";
import { useGitHubStore } from "./store/githubStore";

export default function App() {
  // Block the default browser context menu globally
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  // Intercept all link clicks and open external URLs in the default browser
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        e.preventDefault();
        openUrl(href);
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  // Check GitHub auth on startup so token is recognized before panel opens
  useEffect(() => {
    useGitHubStore.getState().checkAuth();
  }, []);

  return <RootLayout />;
}
