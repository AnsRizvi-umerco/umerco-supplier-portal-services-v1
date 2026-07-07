const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function readEnv(key: (typeof required)[number]): string | undefined {
  if (key === "SUPABASE_URL") {
    return process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  }
  if (key === "SUPABASE_ANON_KEY") {
    return process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  }
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
}

export function getEnv(key: (typeof required)[number]): string {
  const value = readEnv(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function assertEnv() {
  for (const key of required) {
    readEnv(key);
  }
}
