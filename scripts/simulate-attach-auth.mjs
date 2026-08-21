/**
 * Simulate Services attachAuth middleware resolution.
 */
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

dotenv.config();

const sub = "60c3c1b9-9836-4c9b-9dac-5e7c180f8515";
const actor = "partner_admin";

async function resolvePortalUser(payload) {
  const pool = new Pool({ connectionString: process.env.MASTER_DATABASE_URL });
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.business_partner_id, u.status,
            bp.code AS partner_code, bp.name AS partner_name, bp.status AS partner_status
     FROM app_users u
     INNER JOIN business_partners bp ON bp.id = u.business_partner_id
     WHERE u.id = $1 AND u.role = 'partner_admin'::user_role`,
    [payload.sub]
  );
  await pool.end();
  const row = rows[0];
  if (!row || row.status !== "active" || row.partner_status !== "active") return null;
  return {
    id: row.id,
    actor: "partner_admin",
    email: row.email,
    full_name: row.full_name,
    business_partner_id: row.business_partner_id,
    business_partner_code: row.partner_code,
    business_partner_name: row.partner_name
  };
}

async function resolveOperationsSupplier(portalUser) {
  const pool = new Pool({ connectionString: process.env.OPERATIONS_DATABASE_URL });
  const byCode = await pool.query(
    "SELECT id, code, name, email, language FROM suppliers WHERE code = $1 LIMIT 1",
    [portalUser.business_partner_code]
  );
  if (byCode.rows[0]) {
    await pool.end();
    return byCode.rows[0];
  }
  const byEmail = await pool.query(
    "SELECT id, code, name, email, language FROM suppliers WHERE email ILIKE $1 LIMIT 1",
    [portalUser.email]
  );
  await pool.end();
  return byEmail.rows[0] ?? null;
}

const token = jwt.sign({ sub, actor }, process.env.JWT_SECRET, { expiresIn: "1h" });
const decoded = jwt.verify(token, process.env.JWT_SECRET);
console.log("JWT verify:", decoded.sub, decoded.actor);

const portalUser = await resolvePortalUser({ sub: decoded.sub, actor: decoded.actor });
console.log("portalUser:", portalUser?.email, portalUser?.business_partner_code);

const supplier = portalUser ? await resolveOperationsSupplier(portalUser) : null;
console.log("supplier:", supplier?.name, supplier?.code);
