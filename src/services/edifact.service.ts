import { getOperationsPool } from "@/config/operations-db";

export async function ingestEdifact(body: unknown) {
  const raw = (typeof body === "string" ? body : JSON.stringify(body ?? "")).trim();
  if (!raw || raw === "{}") {
    return { status: 400 as const, body: { error: "Empty body" } };
  }

  try {
    await getOperationsPool().query(
      "INSERT INTO edifact_outputs (edifact_string) VALUES ($1)",
      [raw]
    );
    return { status: 200 as const, body: null };
  } catch (error) {
    console.error("[edifact] insert failed", error);
    return { status: 500 as const, body: { error: "Insert failed" } };
  }
}

export async function listEdifactOutputs() {
  try {
    const { rows } = await getOperationsPool().query(
      `SELECT id, edifact_string, received_at
       FROM edifact_outputs
       ORDER BY received_at DESC`
    );
    return { status: 200 as const, body: { rows } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load EDIFACT outputs";
    return { status: 500 as const, body: { error: message, rows: [] } };
  }
}
