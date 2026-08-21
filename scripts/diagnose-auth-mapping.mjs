/**
 * Diagnose supplier mapping for Master Portal auth (no credentials needed).
 * Usage: node scripts/diagnose-auth-mapping.mjs [email]
 */
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const email = process.argv[2] ?? "haroon.syed@umerco.com";

async function findOperationsSupplier(pool, portalUser) {
  const code = portalUser.partner_code?.trim();
  const userEmail = portalUser.email?.trim();

  if (portalUser.actor === "supplier") {
    const byEmail = await pool.query(
      "SELECT id, code, name, email, status FROM suppliers WHERE email ILIKE $1 LIMIT 1",
      [userEmail]
    );
    if (byEmail.rows[0]) return { match: "email", row: byEmail.rows[0] };

    if (code) {
      const byCode = await pool.query(
        "SELECT id, code, name, email, status FROM suppliers WHERE code = $1 LIMIT 1",
        [code]
      );
      if (byCode.rows[0]) return { match: "code", row: byCode.rows[0] };
    }
    return null;
  }

  if (code) {
    const byCode = await pool.query(
      "SELECT id, code, name, email, status FROM suppliers WHERE code = $1 LIMIT 1",
      [code]
    );
    if (byCode.rows[0]) return { match: "code", row: byCode.rows[0] };
  }

  const byEmail = await pool.query(
    "SELECT id, code, name, email, status FROM suppliers WHERE email ILIKE $1 LIMIT 1",
    [userEmail]
  );
  if (byEmail.rows[0]) return { match: "email", row: byEmail.rows[0] };

  return null;
}

async function main() {
  console.log(`Diagnosing auth mapping for: ${email}\n`);

  const masterUrl = process.env.MASTER_DATABASE_URL;
  const operationsUrl = process.env.OPERATIONS_DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;

  console.log(`JWT_SECRET set: ${Boolean(jwtSecret)}`);
  console.log(`MASTER_DATABASE_URL set: ${Boolean(masterUrl)}`);
  console.log(`OPERATIONS_DATABASE_URL set: ${Boolean(operationsUrl)}\n`);

  if (!masterUrl) {
    console.log("FAIL: MASTER_DATABASE_URL missing");
    process.exit(1);
  }

  const masterPool = new Pool({ connectionString: masterUrl });

  const partner = await masterPool.query(
    `SELECT u.id, u.email, u.full_name, u.status, u.role,
            bp.code AS partner_code, bp.name AS partner_name, bp.status AS partner_status
     FROM app_users u
     INNER JOIN business_partners bp ON bp.id = u.business_partner_id
     WHERE lower(u.email) = lower($1)
       AND u.role = 'partner_admin'::user_role`,
    [email]
  );

  const supplierUser = await masterPool.query(
    `SELECT s.id, s.email, s.full_name, s.status,
            bp.code AS partner_code, bp.name AS partner_name, bp.status AS partner_status
     FROM suppliers s
     INNER JOIN business_partners bp ON bp.id = s.business_partner_id
     WHERE lower(s.email) = lower($1)`,
    [email]
  );

  await masterPool.end();

  let portalUser = null;
  if (partner.rows[0]) {
    portalUser = { actor: "partner_admin", ...partner.rows[0] };
    console.log("Master Portal user (partner_admin):");
  } else if (supplierUser.rows[0]) {
    portalUser = { actor: "supplier", ...supplierUser.rows[0] };
    console.log("Master Portal user (supplier):");
  } else {
    console.log("FAIL: No Master Portal user found for this email");
    process.exit(1);
  }

  console.log(`  id: ${portalUser.id}`);
  console.log(`  actor: ${portalUser.actor}`);
  console.log(`  status: ${portalUser.status}`);
  console.log(`  partner_code: ${portalUser.partner_code}`);
  console.log(`  partner_status: ${portalUser.partner_status}\n`);

  if (!operationsUrl) {
    console.log("SKIP operations lookup (OPERATIONS_DATABASE_URL missing)");
    process.exit(0);
  }

  const operationsPool = new Pool({ connectionString: operationsUrl });
  const mapped = await findOperationsSupplier(operationsPool, portalUser);
  await operationsPool.end();

  if (mapped) {
    console.log(`Operations DB supplier matched by ${mapped.match}:`);
    console.log(
      `  FOUND: ${mapped.row.name} (${mapped.row.code}) <${mapped.row.email}> status=${mapped.row.status}`
    );
    console.log("\nPASS: Auth middleware can resolve an operations supplier");
    process.exit(0);
  }

  console.log("\nOperations DB supplier:");
  console.log(`  NOT FOUND for code "${portalUser.partner_code}" or email "${portalUser.email}"`);
  console.log(
    "\nFAIL: No operations supplier matches this portal user. A supplier row will be auto-provisioned on first supplier login."
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
