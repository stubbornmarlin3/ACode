/**
 * Centralized Tauri invoke wrapper with consistent error handling.
 *
 * All Tauri IPC calls should go through this layer so that:
 * 1. Errors are logged consistently instead of silently swallowed
 * 2. Callers get typed return values
 * 3. There's a single place to add retry logic / telemetry later
 */

import { invoke as rawInvoke } from "@tauri-apps/api/core";

/**
 * Invoke a Tauri command. Errors are always logged to the console.
 * Throws on failure — callers must handle errors explicitly.
 */
export async function tauriInvoke<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await rawInvoke<T>(cmd, args);
  } catch (err) {
    console.error(`[tauri] ${cmd} failed:`, err);
    throw err;
  }
}

/**
 * Fire-and-forget variant for commands where failure is non-critical
 * (e.g. revealing in explorer, file watchers, resize).
 * Errors are logged but never thrown.
 */
export async function tauriInvokeQuiet(cmd: string, args?: Record<string, unknown>): Promise<void> {
  try {
    await rawInvoke(cmd, args);
  } catch (err) {
    console.warn(`[tauri] ${cmd} failed (non-critical):`, err);
  }
}
