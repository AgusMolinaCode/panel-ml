"use server";

import { revalidatePath } from "next/cache";
import { syncRecentOrders } from "@/lib/ml/orders";

export async function syncOrdersAction(days = 90): Promise<{ success: boolean; processed: number; error?: string }> {
  try {
    const processed = await syncRecentOrders(days);
    revalidatePath("/dashboard");
    return { success: true, processed };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    return { success: false, processed: 0, error: message };
  }
}
