import { deljitMessageSchema } from "@/schemas";
import { supabaseAdmin } from "@/integrations/supabase/admin";

export async function handleDeljit(body: unknown) {
  const parsed = deljitMessageSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid DELJIT payload" };
  }

  const { supplierCode, payload } = parsed.data;
  const { data: supplier } = await supabaseAdmin
    .from("suppliers")
    .select("id")
    .eq("code", supplierCode)
    .single();

  if (!supplier) {
    return { ok: true, status: 200 };
  }

  const { data: schedule } = await supabaseAdmin
    .from("delivery_schedules")
    .upsert(
      {
        deljit_ref: payload.deljitRef,
        supplier_id: supplier.id,
        period_start: payload.periodStart,
        period_end: payload.periodEnd,
        release_date: payload.releaseDate ?? null,
        status: "pending",
        canonical_json: parsed.data
      },
      { onConflict: "deljit_ref" }
    )
    .select("id")
    .single();

  if (schedule) {
    await supabaseAdmin.from("schedule_lines").delete().eq("schedule_id", schedule.id);
    await supabaseAdmin.from("schedule_lines").insert(
      payload.lines.map((line) => ({
        schedule_id: schedule.id,
        part_no: line.partNo,
        description: line.description,
        qty_required: line.qtyRequired,
        uom: line.uom,
        deliver_by: line.deliverBy,
        facility: line.facility
      }))
    );
  }

  await supabaseAdmin.from("audit_log").insert({
    supplier_id: supplier.id,
    action: "webhook_received",
    doc_ref: payload.deljitRef,
    doc_type: "DELJIT",
    details: { message: parsed.data }
  });

  return { ok: true, status: 200 };
}
