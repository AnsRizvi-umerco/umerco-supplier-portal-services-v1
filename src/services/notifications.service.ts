import type { Pool } from "pg";
import type { PortalAuthUser, SupplierRow } from "@/middleware/auth";
import { getOperationsPool } from "@/config/operations-db";
import {
  backfillScheduleNotifications,
  ensureNotificationsTable
} from "@/config/operations-schema";
import { resolveDataScope, scopePredicate } from "@/utils/data-scope";

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  tone: string;
  href: string | null;
  doc_ref: string | null;
  doc_type: string | null;
  schedule_id: string | null;
  read_at: string | null;
  created_at: string;
};

function opsPool(pool?: Pool): Pool {
  return pool ?? getOperationsPool();
}

async function sendInboundEmailAlert(params: {
  pool: Pool;
  supplierId: string;
  title: string;
  body: string;
}): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const fromEmail = process.env.SENDGRID_FROM_EMAIL?.trim();
  if (!apiKey || !fromEmail) return;

  try {
    const { rows } = await params.pool.query<{
      to_email: string | null;
      deljit_email_alerts: boolean | null;
    }>(
      `SELECT COALESCE(NULLIF(notification_email, ''), email) AS to_email,
              COALESCE(deljit_email_alerts, true) AS deljit_email_alerts
       FROM suppliers
       WHERE id = $1
       LIMIT 1`,
      [params.supplierId]
    );

    const recipient = rows[0];
    if (!recipient?.to_email || recipient.deljit_email_alerts === false) return;

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: recipient.to_email }] }],
        from: { email: fromEmail, name: "Umerco Supplier Portal" },
        subject: params.title,
        content: [{ type: "text/plain", value: params.body }]
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Failed to send notification email:", response.status, detail);
    }
  } catch (error) {
    console.error("Failed to send notification email:", error);
  }
}

export async function createScheduleNotification(params: {
  supplierId: string;
  companyId?: string | null;
  title: string;
  body: string;
  docRef: string;
  docType: string;
  scheduleId?: string | null;
  tone?: "info" | "warning" | "error" | "success";
  pool?: Pool;
}): Promise<void> {
  try {
    const pool = opsPool(params.pool);
    await ensureNotificationsTable(pool);

    const href = params.scheduleId
      ? `/schedules?schedule=${encodeURIComponent(params.scheduleId)}`
      : "/schedules";

    await pool.query(
      `INSERT INTO notifications (
         supplier_id, company_id, title, body, tone, href, doc_ref, doc_type, schedule_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        params.supplierId,
        params.companyId ?? null,
        params.title,
        params.body,
        params.tone ?? "info",
        href,
        params.docRef,
        params.docType,
        params.scheduleId ?? null
      ]
    );

    void sendInboundEmailAlert({
      pool,
      supplierId: params.supplierId,
      title: params.title,
      body: params.body
    });
  } catch (error) {
    console.error("Failed to create schedule notification:", error);
  }
}

export async function listNotifications(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  pool?: Pool
) {
  const scope = resolveDataScope(portalUser, supplier);
  if (!scope) return { status: 200 as const, body: { notifications: [], unreadCount: 0 } };

  const db = opsPool(pool);
  try {
    await ensureNotificationsTable(db);
  } catch (error) {
    console.error("Failed to ensure notifications table:", error);
    return { status: 200 as const, body: { notifications: [], unreadCount: 0 } };
  }

  try {
    await backfillScheduleNotifications(db);
  } catch (error) {
    console.error("Failed to backfill schedule notifications:", error);
  }

  try {
    const { rows } = await db.query<NotificationRow>(
      `SELECT id, title, body, tone, href, doc_ref, doc_type, schedule_id, read_at, created_at
       FROM notifications
       WHERE ${scopePredicate(1, 2)}
       ORDER BY created_at DESC
       LIMIT 50`,
      [scope.companyId, scope.supplierId]
    );

    const unreadCount = rows.filter((row) => !row.read_at).length;
    return {
      status: 200 as const,
      body: {
        notifications: rows.map((row) => ({
          id: row.id,
          title: row.title,
          body: row.body,
          time: row.created_at,
          unread: !row.read_at,
          href: row.href ?? "/schedules",
          tone: (row.tone as "info" | "warning" | "error" | "success") || "info"
        })),
        unreadCount
      }
    };
  } catch (error) {
    console.error("Failed to list notifications:", error);
    return { status: 200 as const, body: { notifications: [], unreadCount: 0 } };
  }
}

export async function markAllNotificationsRead(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  pool?: Pool
) {
  const scope = resolveDataScope(portalUser, supplier);
  if (!scope) return { status: 200 as const, body: { updated: 0 } };

  try {
    const db = opsPool(pool);
    await ensureNotificationsTable(db);
    const { rowCount } = await db.query(
      `UPDATE notifications
       SET read_at = now()
       WHERE read_at IS NULL
         AND ${scopePredicate(1, 2)}`,
      [scope.companyId, scope.supplierId]
    );

    return { status: 200 as const, body: { updated: rowCount ?? 0 } };
  } catch (error) {
    console.error("Failed to mark notifications read:", error);
    return { status: 200 as const, body: { updated: 0 } };
  }
}

export async function markNotificationRead(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  id: string,
  pool?: Pool
) {
  const scope = resolveDataScope(portalUser, supplier);
  if (!scope) return { status: 404 as const, body: { error: "Notification not found" } };

  try {
    const db = opsPool(pool);
    await ensureNotificationsTable(db);
    const { rowCount } = await db.query(
      `UPDATE notifications
       SET read_at = now()
       WHERE id = $3
         AND read_at IS NULL
         AND ${scopePredicate(1, 2)}`,
      [scope.companyId, scope.supplierId, id]
    );

    return { status: 200 as const, body: { updated: rowCount ?? 0 } };
  } catch (error) {
    console.error("Failed to mark notification read:", error);
    return { status: 200 as const, body: { updated: 0 } };
  }
}
