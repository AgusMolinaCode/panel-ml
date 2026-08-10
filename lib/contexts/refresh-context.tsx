"use client";
import { createContext, useContext } from "react";

export const REFRESH_EVENT = "panel-ml:global-refresh";

type RefreshContextType = {
  triggerGlobalRefresh: () => Promise<void>;
};

// Default is a no-op; DashboardClient overrides via Provider
export const RefreshContext = createContext<RefreshContextType>({
  triggerGlobalRefresh: async () => {},
});

export function useRefresh(): RefreshContextType {
  return useContext(RefreshContext);
}
