import { toCompactYyyymmdd } from "@/utils/dates/compact";
import type { DeljitMessage } from "@/schemas/deljit";

export type ScheduleLineRow = {
  id: string;
  part_no: string;
  description: string | null;
  qty_required: number;
  uom: string;
  deliver_by: string;
  facility: string;
};

function normalizeFromMessage(line: DeljitMessage["payload"]["lines"][number]) {
  return {
    partNo: line.partNo,
    description: line.description,
    qtyRequired: line.qtyRequired,
    uom: line.uom,
    deliverBy: toCompactYyyymmdd(line.deliverBy),
    facility: line.facility
  };
}

function normalizeFromDb(line: ScheduleLineRow) {
  return {
    partNo: line.part_no,
    description: line.description ?? "",
    qtyRequired: line.qty_required,
    uom: line.uom,
    deliverBy: toCompactYyyymmdd(line.deliver_by),
    facility: line.facility
  };
}

function stableLineKey(line: ReturnType<typeof normalizeFromMessage>) {
  return JSON.stringify([line.partNo, line.facility, line.deliverBy, line.qtyRequired, line.uom, line.description]);
}

/** True when normalized payload lines match normalized schedule_lines (order-independent). */
export function linesConsistentWithMessage(message: DeljitMessage, dbLines: ScheduleLineRow[]): boolean {
  const fromMessage = message.payload.lines.map(normalizeFromMessage).map(stableLineKey).sort();
  const fromDb = dbLines.map(normalizeFromDb).map(stableLineKey).sort();
  if (fromMessage.length !== fromDb.length) return false;
  return fromMessage.every((k, i) => k === fromDb[i]);
}
