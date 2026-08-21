import { z } from "zod";
import { getOperationsPool } from "@/config/operations-db";
import { resolveFacilityLabel } from "@/utils/facilities";

const reqSchema = z.object({
  submissionId: z.string().uuid()
});

function toZpl(params: {
  partNo: string;
  poNumber: string;
  poLine: string;
  qty: number;
  uom: string;
  supplierName: string;
  supplierCode: string;
  asnRef: string;
  facility: string;
  packageIndex: number;
  packageCount: number;
}) {
  const facilityCode = resolveFacilityLabel(params.facility);
  return `^XA
^PW812
^LL1218
^FO40,40^A0N,34,34^FD${facilityCode}^FS
^FO40,80^A0N,28,28^FDShip-to facility^FS
^FO40,150^A0N,60,60^FD${params.partNo}^FS
^FO40,230^A0N,38,38^FDQty: ${params.qty} ${params.uom}^FS
^FO40,280^A0N,30,30^FDSupplier: ${params.supplierName} (${params.supplierCode})^FS
^FO40,330^A0N,30,30^FDPO: ${params.poNumber}-${params.poLine}^FS
^FO40,380^A0N,30,30^FDPackage: ${params.packageIndex} of ${params.packageCount}^FS
^FO40,430^BY2,3,90^BCN,90,Y,N,N^FD${params.partNo}|${params.poNumber}|${params.qty}^FS
^FO40,560^BY2,3,90^BCN,90,Y,N,N^FD${params.asnRef}^FS
^FO40,700^A0N,26,26^FDAIAG B-10 Rev 5^FS
^XZ`;
}

export async function generateLabels(body: unknown) {
  const parsed = reqSchema.safeParse(body);
  if (!parsed.success) return { status: 400 as const, body: { labels: [] } };

  const { rows } = await getOperationsPool().query<{ canonical_json: unknown }>(
    "SELECT canonical_json FROM submissions WHERE id = $1 LIMIT 1",
    [parsed.data.submissionId]
  );

  const canonical = rows[0]?.canonical_json as { payload?: Record<string, unknown> } | null | undefined;
  const payload = canonical?.payload;
  const lines = (Array.isArray(payload?.lines) ? payload.lines : []) as Record<string, unknown>[];

  const labels = lines.map((line, index: number) =>
    toZpl({
      partNo: String(line.partNo ?? ""),
      poNumber: String(line.poNumber ?? ""),
      poLine: String(line.poLine ?? ""),
      qty: Number(line.qtyShipped ?? line.qty ?? 0),
      uom: String(line.uom ?? "EA"),
      supplierName: String(payload?.supplierName ?? "Supplier"),
      supplierCode: String(payload?.supplierCode ?? "UNKNOWN"),
      asnRef: String(payload?.asnRef ?? "ASN"),
      facility: String(payload?.shipToFacility ?? ""),
      packageIndex: index + 1,
      packageCount: Number(payload?.packageCount ?? lines.length)
    })
  );

  return { status: 200 as const, body: { labels } };
}
