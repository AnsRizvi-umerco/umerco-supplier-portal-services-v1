import { statusCallbackSchema } from "@/schemas";
import { supabaseAdmin } from "@/integrations/supabase/admin";

export async function handleStatusCallback(body: unknown) {
  const parsed = statusCallbackSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid status callback payload" };
  }

  const callback = parsed.data;
  const update = {
    status: callback.status,
    iwhi_response: callback,
    error_message: callback.status === "error" ? (callback.errorDetail ?? "IWHI submission failed") : null,
    iwhi_message_id: callback.messageId ?? null,
    last_callback_at: new Date().toISOString()
  };

  const primary = await supabaseAdmin.from("submissions").update(update).eq("id", callback.transactionId).select("id, supplier_id").single();

  let submission = primary.data;
  if (!submission) {
    const fallback = await supabaseAdmin
      .from("submissions")
      .update(update)
      .eq("iwhi_transaction_id", callback.transactionId)
      .select("id, supplier_id")
      .single();
    submission = fallback.data;
  }

  if (submission) {
    await supabaseAdmin.from("audit_log").insert({
      supplier_id: submission.supplier_id,
      action: "status_callback_received",
      doc_ref: submission.id,
      doc_type: null,
      details: callback
    });
  }

  return { ok: true, status: 200 };
}
