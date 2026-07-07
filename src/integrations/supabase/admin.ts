import { getEnv } from "@/config/env";
import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
