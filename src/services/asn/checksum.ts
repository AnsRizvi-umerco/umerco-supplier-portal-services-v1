import { createHash } from "node:crypto";
import { canonicalizeTurnaround, type AsnTurnaround, type SealedTurnaround } from "@/services/asn/domain";

export function checksumTurnaround(data: AsnTurnaround): string {
  return createHash("sha256").update(canonicalizeTurnaround(data), "utf8").digest("hex");
}

export function sealTurnaround(data: AsnTurnaround): SealedTurnaround {
  return { data, checksum: checksumTurnaround(data) };
}

export function verifyTurnaround(sealed: SealedTurnaround): boolean {
  return sealed.checksum === checksumTurnaround(sealed.data);
}
