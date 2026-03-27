import { useEffect } from "react";
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

  // Check GitHub auth on startup so token is recognized before panel opens
  useEffect(() => {
    useGitHubStore.getState().checkAuth();
  }, []);

  return <RootLayout />;
}
