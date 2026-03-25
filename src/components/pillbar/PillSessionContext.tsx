import { createContext, useContext } from "react";

/**
 * When a component is rendered inside a PillPanel slot, this context
 * provides the specific sessionId that panel should display.
 * useActive*State hooks read this to pick the right project/session
 * instead of the global activeKey.
 */
export const PillSessionContext = createContext<string | null>(null);

/** Returns the panel-specific session ID, or null if not inside a panel slot. */
export function usePillSessionId(): string | null {
  return useContext(PillSessionContext);
}
