import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

export async function clipboardWrite(text: string): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch {
    // Fallback to Web Clipboard API
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

export async function clipboardRead(): Promise<string> {
  try {
    return await readText();
  } catch {
    // Fallback to Web Clipboard API
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  }
}
