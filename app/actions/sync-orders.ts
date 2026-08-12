"use server";

import { revalidatePath } from "next/cache";
import { syncRecentOrders } from "@/lib/ml/orders";
import { runSyncClaims } from "@/worker/sync-claims";

/**
 * Fast sync: fetches order details and refreshes claim statuses.
 * Shipments are synced separately by /api/sync every 5 min.
 */
export async function syncOrdersAction(days = 1): Promise<{ success: boolean; processed: number; error?: string }> {
  try {
    const processed = await syncRecentOrders(days, 50, false);
    // Refresh claims after orders so open/closed claim badges appear immediately.
    await runSyncClaims();
    revalidatePath("/dashboard");
    return { success: true, processed };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    return { success: false, processed: 0, error: message };
  }
}
