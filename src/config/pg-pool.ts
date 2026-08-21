import { promises as dnsPromises } from "node:dns";
import { Pool } from "pg";

const SUPABASE_DB_HOST = /^db\.([a-z0-9]+)\.supabase\.co$/i;

/** AWS IPv6 prefixes used by `db.*.supabase.co` AAAA records. */
const AWS_IPV6_REGIONS: Array<{ prefix: string; region: string }> = [
  { prefix: "2600:1f18:", region: "us-east-1" },
  { prefix: "2600:1f16:", region: "us-east-2" },
  { prefix: "2600:1f1c:", region: "us-west-1" },
  { prefix: "2600:1f14:", region: "us-west-2" },
  { prefix: "2600:1f11:", region: "ca-central-1" },
  { prefix: "2600:1f1e:", region: "sa-east-1" },
  { prefix: "2a05:d018:", region: "eu-west-1" },
  { prefix: "2a05:d01c:", region: "eu-west-2" },
  { prefix: "2a05:d01a:", region: "eu-west-3" },
  { prefix: "2a05:d014:", region: "eu-central-1" },
  { prefix: "2a05:d012:", region: "eu-north-1" },
  { prefix: "2406:da14:", region: "ap-northeast-1" },
  { prefix: "2406:da12:", region: "ap-northeast-2" },
  { prefix: "2406:da16:", region: "ap-northeast-3" },
  { prefix: "2406:da18:", region: "ap-southeast-1" },
  { prefix: "2406:da1c:", region: "ap-southeast-2" },
  { prefix: "2406:da1a:", region: "ap-south-1" }
];

const rewrittenHosts = new Set<string>();

async function hasIpv4(hostname: string): Promise<boolean> {
  try {
    return (await dnsPromises.resolve4(hostname)).length > 0;
  } catch {
    return false;
  }
}

function regionFromIpv6(address: string): string | null {
  const lower = address.toLowerCase();
  return AWS_IPV6_REGIONS.find((entry) => lower.startsWith(entry.prefix))?.region ?? null;
}

async function inferSupabasePoolerHost(dbHost: string): Promise<string | null> {
  let region: string | null = null;
  try {
    const [ipv6] = await dnsPromises.resolve6(dbHost);
    if (ipv6) region = regionFromIpv6(ipv6);
  } catch {
    // Direct host may fail getaddrinfo; resolve6 still works via DNS.
  }

  if (!region) return null;

  for (const generation of ["aws-1", "aws-0"]) {
    const poolerHost = `${generation}-${region}.pooler.supabase.com`;
    if (await hasIpv4(poolerHost)) return poolerHost;
  }

  return null;
}

function ensurePoolerUsername(username: string, projectRef: string): string {
  if (username.includes(".")) return username;
  return `${username}.${projectRef}`;
}

/**
 * Keep credentials from the db-route URL. If the host is IPv6-only
 * (`db.*.supabase.co` with no A record), swap in the same-region IPv4 pooler.
 */
export async function toReachableConnectionString(connectionString: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }

  const match = SUPABASE_DB_HOST.exec(url.hostname);
  if (!match) return connectionString;
  if (await hasIpv4(url.hostname)) return connectionString;

  const projectRef = match[1];
  const poolerHost = await inferSupabasePoolerHost(url.hostname);
  if (!poolerHost) {
    throw new Error(
      `Operations host ${url.hostname} is IPv6-only and no IPv4 pooler could be resolved.`
    );
  }

  if (!rewrittenHosts.has(url.hostname)) {
    rewrittenHosts.add(url.hostname);
    console.warn(
      `Operations DB ${url.hostname} is IPv6-only; using IPv4 pooler ${poolerHost}`
    );
  }

  url.hostname = poolerHost;
  url.username = ensurePoolerUsername(url.username, projectRef);

  return url.toString();
}

export function createPgPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export async function createReachablePgPool(connectionString: string): Promise<Pool> {
  return createPgPool(await toReachableConnectionString(connectionString));
}
