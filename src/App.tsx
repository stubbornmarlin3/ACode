import { useEffect } from "react";
import "./App.css";
import { RootLayout } from "./components/layout/RootLayout";

export default function App() {
  // Block the default browser context menu globally
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  return <RootLayout />;
}
