const required = ["MASTER_DATABASE_URL"] as const;

export function getOptionalEnv(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

export function getEnv(key: (typeof required)[number] | "OPERATIONS_DATABASE_URL"): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function assertEnv() {
  for (const key of required) {
    getEnv(key);
  }
}
