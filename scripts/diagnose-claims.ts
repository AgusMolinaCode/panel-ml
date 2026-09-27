/**
 * Temp diagnostic: compare claim searches for one order.
 * Usage: npx tsx scripts/diagnose-claims.ts [order_id]
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const ORDER = Number(process.argv[2] ?? 2000014854924641);

async function main(): Promise<void> {
  const { getCredentials } = await import("../lib/db");
  const { mlGet } = await import("../lib/ml/client");

  const creds = await getCredentials();
  if (!creds) {
    console.log("NO CREDENTIALS");
    return;
  }
  console.log("seller user_id:", creds.user_id);

  // 1) Claims for the specific order (no status filter)
  const byOrder = await mlGet<{
    paging: { total: number };
    data: Array<Record<string, unknown>>;
  }>("/post-purchase/v1/claims/search", { order_id: ORDER, limit: 50 });
  console.log(`\n[1] claims for order ${ORDER}: total=${byOrder.paging?.total}`);
  for (const c of byOrder.data ?? []) {
    console.log(
      JSON.stringify({
        id: c.id,
        status: c.status,
        type: c.type,
        stage: c.stage,
        resource: c.resource,
        resource_id: c.resource_id,
        players: (c.players as Array<Record<string, unknown>> | undefined)?.map((p) => ({
          role: p.role,
          type: p.type,
          user_id: p.user_id,
        })),
      })
    );
  }

  // 2) Global open claims as respondent (what the banner asks for)
  const open = await mlGet<{
    paging: { total: number };
    data: Array<Record<string, unknown>>;
  }>("/post-purchase/v1/claims/search", {
    "players.user_id": creds.user_id,
    "players.role": "respondent",
    status: "opened",
    limit: 50,
    offset: 0,
    sort: "last_updated:desc",
  });
  console.log(`\n[2] opened claims where I'm respondent: total=${open.paging?.total}`);
  for (const c of open.data ?? []) {
    console.log(`  claim=${c.id} resource=${c.resource} resource_id=${c.resource_id} type=${c.type} stage=${c.stage}`);
  }

  // 3) ALL claims as respondent (any status) — sanity check
  try {
    const all = await mlGet<{
      paging: { total: number };
      data: Array<Record<string, unknown>>;
    }>("/post-purchase/v1/claims/search", {
      "players.user_id": creds.user_id,
      "players.role": "respondent",
      status: "closed",
      limit: 50,
      offset: 0,
    });
    console.log(`\n[3] CLOSED claims where I'm respondent: total=${all.paging?.total}`);
    for (const c of all.data ?? []) {
      console.log(`  claim=${c.id} status=${c.status} resource=${c.resource} resource_id=${c.resource_id} type=${c.type}`);
    }
  } catch (e) {
    console.log(`\n[3] closed-respondent search failed: ${(e as Error)?.message ?? e}`);
  }

  // 4) Resolve EVERY open claim to its real order_id via ML
  console.log(`\n[4] resolving open claims → orders (via ML):`);
  for (const c of open.data ?? []) {
    const resource = String(c.resource);
    const rid = Number(c.resource_id);
    if (resource === "shipment") {
      try {
        const ship = await mlGet<Record<string, unknown>>(`/shipments/${rid}`);
        console.log(
          `  claim=${c.id} SHIPMENT ${rid} → order_id=${ship.order_id} status=${ship.status}`
        );
      } catch (e) {
        console.log(`  claim=${c.id} SHIPMENT ${rid} → FAILED: ${(e as Error)?.message ?? e}`);
      }
    } else {
      console.log(`  claim=${c.id} ${resource} ${rid} → already an order`);
    }
  }

  // 5) Is the user-reported ID in OUR DB at all?
  const { getSupabase } = await import("../lib/supabase");
  const supabase = getSupabase();
  const { data: dbOrder } = await supabase
    .from("orders")
    .select("id, status, shipping_json, claim_status")
    .eq("id", ORDER)
    .maybeSingle();
  console.log(
    `\n[5] order ${ORDER} in our DB: ${dbOrder ? `FOUND status=${dbOrder.status} claim_status=${dbOrder.claim_status}` : "NOT FOUND"}`
  );
  if (dbOrder?.shipping_json) {
    const ship = JSON.parse(dbOrder.shipping_json as string) as { id?: number };
    console.log(`    shipping id in order row: ${ship?.id ?? "none"}`);
  }

  // 7) Is that number the seller_pack_id of some order in our DB? + which account is connected
  const { data: packHit } = await supabase
    .from("orders")
    .select("id, status, raw_json")
    .ilike("raw_json", `%${ORDER}%`)
    .limit(10);
  console.log(`\n[7] orders whose raw_json contains ${ORDER}: ${packHit?.length ?? 0}`);
  for (const o of (packHit as Array<{ id: number; status: string; raw_json: string }> | null) ?? []) {
    try {
      const raw = JSON.parse(o.raw_json) as { seller_pack_id?: number | null };
      console.log(`  order ${o.id} status=${o.status} seller_pack_id=${raw.seller_pack_id ?? "null"}`);
    } catch {
      console.log(`  order ${o.id} (raw unparseable)`);
    }
  }

  const { data: credsRow } = await supabase.from("ml_credentials").select("user_id, nickname, email").eq("id", 1).single();
  console.log(`\n[8] connected account: user_id=${(credsRow as { user_id: number } | null)?.user_id} nickname=${(credsRow as { nickname: string | null } | null)?.nickname}`);

  // 9) Simulate the fixed banner: resolve every open claim to an order id
  console.log(`\n[9] FINAL — what the banner will show:`);
  const finalOrderIds = new Set<number>();
  for (const c of open.data ?? []) {
    if (c.resource === "order") finalOrderIds.add(Number(c.resource_id));
    else if (c.resource === "shipment") {
      const ship = await mlGet<{ order_id?: number }>(`/shipments/${Number(c.resource_id)}`);
      if (ship?.order_id) finalOrderIds.add(ship.order_id);
    }
  }
  const { data: inDb } = await supabase
    .from("orders")
    .select("id, items_json")
    .in("id", Array.from(finalOrderIds));
  const dbIds = new Set<number>();
  for (const r of (inDb as Array<{ id: number }> | null) ?? []) dbIds.add(r.id);
  for (const oid of finalOrderIds) {
    console.log(`  #${oid} — ${dbIds.has(oid) ? "en DB (con título)" : "synthetic chip (Sin título)"}`);
  }
  console.log(`  TOTAL chips: ${finalOrderIds.size}`);
  const shipmentIds = (open.data ?? [])
    .filter((c) => c.resource === "shipment")
    .map((c) => Number(c.resource_id));
  if (shipmentIds.length > 0) {
    const { data: dbShipments } = await supabase
      .from("shipments")
      .select("id, order_id, status")
      .in("id", shipmentIds);
    console.log(`\n[6] shipment claims → our shipments table:`);
    for (const sid of shipmentIds) {
      const row = (dbShipments as Array<{ id: number; order_id: number; status: string }> | null)?.find(
        (s) => s.id === sid
      );
      console.log(`  shipment ${sid} → ${row ? `order ${row.order_id} (status ${row.status})` : "NOT IN DB ❌"}`);
    }
  }
}

main().catch((err) => {
  console.error("ERR:", err?.message ?? err);
  if (err?.body) console.error("body:", JSON.stringify(err.body));
});
