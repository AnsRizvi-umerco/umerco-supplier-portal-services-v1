/**
 * End-to-end login flow check (Master Portal auth -> Supplier Portal API).
 * Usage: node scripts/test-login-flow.mjs [email] [password]
 */

const MASTER_PORTAL =
  process.env.MASTER_PORTAL_BASE_URL ?? "https://master-portal-services-v1-sepia.vercel.app";
const SERVICES_API = process.env.SERVICES_API_URL ?? "http://localhost:3001/api/v1";
const email = process.argv[2] ?? process.env.TEST_LOGIN_EMAIL;
const password = process.argv[3] ?? process.env.TEST_LOGIN_PASSWORD;

function step(name, ok, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark} ${name}${detail ? `: ${detail}` : ""}`);
  return ok;
}

async function main() {
  console.log("Login flow check\n");

  if (!email || !password) {
    console.log("FAIL missing credentials (pass email/password args or TEST_LOGIN_EMAIL/TEST_LOGIN_PASSWORD)");
    process.exit(1);
  }

  // 1. Master Portal login
  let loginRes;
  try {
    loginRes = await fetch(`${MASTER_PORTAL}/api/supplier-portal/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
  } catch (err) {
    step("Master Portal reachable", false, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const loginBody = await loginRes.json().catch(() => null);
  if (!step("Master Portal login", loginRes.ok, loginRes.ok ? "" : loginBody?.error ?? `HTTP ${loginRes.status}`)) {
    process.exit(1);
  }

  const token = loginBody?.access_token;
  const user = loginBody?.user;
  if (!step("Login response shape", Boolean(token && user?.email && user?.actor), `actor=${user?.actor ?? "?"}`)) {
    process.exit(1);
  }

  console.log(`     user: ${user.full_name} <${user.email}> partner=${user.business_partner_code}`);

  // 2. Protected API without token
  const noAuthRes = await fetch(`${SERVICES_API}/profile`);
  step("Profile rejects unauthenticated", noAuthRes.status === 401, `HTTP ${noAuthRes.status}`);

  // 3. Protected API with token
  let profileRes;
  try {
    profileRes = await fetch(`${SERVICES_API}/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    step("Services API reachable", false, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const profileBody = await profileRes.json().catch(() => null);
  if (profileRes.ok) {
    step("Profile with token", true, `${profileBody?.name ?? "?"} (${profileBody?.code ?? "?"})`);
  } else {
    step(
      "Profile with token",
      false,
      `${profileBody?.error ?? `HTTP ${profileRes.status}`} — operations supplier may not match partner code "${user.business_partner_code}" or email "${user.email}"`
    );
  }

  // 4. Settings endpoint
  const settingsRes = await fetch(`${SERVICES_API}/settings`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const settingsBody = await settingsRes.json().catch(() => null);
  step("Settings with token", settingsRes.ok, settingsRes.ok ? settingsBody?.name ?? "ok" : settingsBody?.error ?? `HTTP ${settingsRes.status}`);

  // 5. Dashboard endpoint
  const dashRes = await fetch(`${SERVICES_API}/dashboard`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  step("Dashboard with token", dashRes.ok, dashRes.ok ? "ok" : `HTTP ${dashRes.status}`);

  process.exit(profileRes.ok && settingsRes.ok && dashRes.ok ? 0 : 1);
}

main();
