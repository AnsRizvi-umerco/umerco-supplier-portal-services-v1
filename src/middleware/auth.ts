import type { NextFunction, Request, Response } from "express";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type SupplierRow = {
  id: string;
  code: string;
  name: string;
  email: string;
  language: string;
};

export type AuthedRequest = Request & {
  user?: User;
  supplier?: SupplierRow | null;
  supabase?: SupabaseClient;
  accessToken?: string;
};

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

import { getEnv } from "@/config/env";

export async function attachAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) {
    req.supplier = null;
    return next();
  }

  const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser(token);

  if (!user) {
    req.supplier = null;
    return next();
  }

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, code, name, email, language")
    .eq("auth_user_id", user.id)
    .single();

  req.user = user;
  req.supplier = supplier;
  req.supabase = supabase;
  req.accessToken = token;
  next();
}

export function requireSupplier(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user || !req.supplier) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
