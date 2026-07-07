import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupplierRow } from "@/middleware/auth";

export async function listSubmissions(
  supplier: SupplierRow | null | undefined,
  supabase: SupabaseClient | undefined
) {
  if (!supplier || !supabase) return { status: 200 as const, body: { submissions: [] } };

  const { data, error } = await supabase
    .from("submissions")
    .select(
      "id, doc_type, ref_no, status, created_at, submitted_at, error_message, iwhi_message_id, last_callback_at"
    )
    .eq("supplier_id", supplier.id)
    .order("created_at", { ascending: false });

  if (error) return { status: 400 as const, body: { submissions: [], error: error.message } };
  return { status: 200 as const, body: { submissions: data } };
}
