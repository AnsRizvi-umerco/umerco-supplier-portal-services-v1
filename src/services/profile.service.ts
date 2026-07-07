import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { SupplierRow } from "@/middleware/auth";

const PROFILE_SELECT = "id, code, name, email, language, status, phone, created_at";

function startOfCurrentUtcMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

export async function getProfile(
  supplier: SupplierRow | null | undefined,
  user: User | undefined,
  supabase: SupabaseClient | undefined
) {
  if (!supplier || !user || !supabase) {
    return { status: 401 as const, body: { error: "Unauthorized" } };
  }

  const { data: profile, error } = await supabase
    .from("suppliers")
    .select(PROFILE_SELECT)
    .eq("auth_user_id", user.id)
    .single();

  if (error || !profile) {
    return { status: 500 as const, body: { error: error?.message ?? "Supplier not found" } };
  }

  const monthStart = startOfCurrentUtcMonth();
  const [totalSubsRes, monthSubsRes, schedulesRes, lastSubRes] = await Promise.all([
    supabase.from("submissions").select("id", { count: "exact", head: true }).eq("supplier_id", supplier.id),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("supplier_id", supplier.id)
      .gte("created_at", monthStart),
    supabase
      .from("delivery_schedules")
      .select("id", { count: "exact", head: true })
      .eq("supplier_id", supplier.id),
    supabase
      .from("submissions")
      .select("created_at")
      .eq("supplier_id", supplier.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const lastSubmissionAt = lastSubRes.data?.created_at ?? null;
  const lastActiveAt = lastSubmissionAt ?? user.last_sign_in_at ?? null;

  return {
    status: 200 as const,
    body: {
      id: profile.id,
      code: profile.code,
      name: profile.name,
      status: profile.status,
      language: profile.language,
      memberSince: profile.created_at,
      phone: profile.phone,
      authEmail: user.email ?? profile.email ?? "",
      lastSignInAt: user.last_sign_in_at ?? null,
      stats: {
        totalSubmissions: totalSubsRes.count ?? 0,
        submissionsThisMonth: monthSubsRes.count ?? 0,
        schedulesReceived: schedulesRes.count ?? 0,
        lastActiveAt
      }
    }
  };
}
