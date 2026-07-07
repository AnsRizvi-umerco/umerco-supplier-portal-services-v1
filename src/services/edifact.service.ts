import { supabaseAdmin } from "@/integrations/supabase/admin";

export async function ingestEdifact(body: unknown) {
  const raw = (typeof body === "string" ? body : JSON.stringify(body ?? "")).trim();
  if (!raw || raw === "{}") {
    return { status: 400 as const, body: { error: "Empty body" } };
  }

  const { error } = await supabaseAdmin.from("edifact_outputs").insert({ edifact_string: raw });
  if (error) {
    console.error("[edifact] insert failed", error);
    return { status: 500 as const, body: { error: "Insert failed" } };
  }
  return { status: 200 as const, body: null };
}

export async function listEdifactOutputs() {
  const { data: rows, error } = await supabaseAdmin
    .from("edifact_outputs")
    .select("id, edifact_string, received_at")
    .order("received_at", { ascending: false });

  if (error) {
    return { status: 500 as const, body: { error: error.message, rows: [] } };
  }
  return { status: 200 as const, body: { rows: rows ?? [] } };
}
