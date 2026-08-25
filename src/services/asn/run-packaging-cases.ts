import {
  buildLicencePlate,
  cartonGroups,
  lucidPackagingCaseResults,
  palletKind,
  palletLabelKind,
  proposePackaging,
  type AsnShipment
} from "@/services/asn/domain";
import { labelsFromShipment } from "@/services/asn/labels-zpl";

const cases = lucidPackagingCaseResults();
let failed = 0;
for (const row of cases) {
  const mark = row.ok ? "ok" : "FAIL";
  console.log(`${mark}  ${row.name}  ${row.detail}`);
  if (!row.ok) failed += 1;
}

const a = {
  id: "ra",
  partNo: "P11-AAAAA-00",
  ran: "RAN-A",
  qty: 80,
  ppc: 10,
  cpp: 10
};
const b = {
  id: "rb",
  partNo: "P11-BBBBB-00",
  ran: "RAN-B",
  qty: 20,
  ppc: 10,
  cpp: 10
};

function fakeRelease(partNo: string, ran: string, id: string, qty: number, ppc: number, cpp: number) {
  return proposePackaging.length
    ? {
        id,
        scheduleId: "s",
        turnaround: {
          data: {
            partNo,
            description: partNo.slice(0, 40),
            shipTo: { code: "LC001", name: "Lucid", street: "1", city: "Casa Grande", zip: "85122", country: "US" },
            shipFrom: { code: "55123", name: "Supplier" },
            buyer: { id: "LUCID", name: "Lucid Motors" },
            poNumber: "PO-1",
            itemNumber: "001",
            releaseNumber: ran,
            price: "10.00",
            uom: "EA"
          },
          checksum: "x"
        },
        deliveryDate: "2026-08-10",
        openQty: qty,
        qtyToShip: qty,
        partsPerCarton: ppc,
        cartonsPerPallet: cpp,
        unitWeightKg: 0.5,
        countryOfOrigin: "US",
        dateControlled: false,
        manufacturingDate: "",
        expirationDate: ""
      }
    : null;
}

const relA = fakeRelease(a.partNo, a.ran, a.id, a.qty, a.ppc, a.cpp)!;
const relB = fakeRelease(b.partNo, b.ran, b.id, b.qty, b.ppc, b.cpp)!;
const mixedLoads = proposePackaging([relA, relB]);
let serial = 1;
const mixedShipment: AsnShipment = {
  asnNumber: "ASN-CASE2",
  shipDate: "2026-08-25",
  shipTime: "10:00",
  transportMode: "TRUCK",
  carrierScac: "RBTW",
  trackingNo: "TRK-1",
  bolNumber: "BOL-1",
  currentStep: 4,
  labelsFrozen: true,
  shipFrom: relA.turnaround.data.shipFrom,
  shipTo: relA.turnaround.data.shipTo,
  buyer: relA.turnaround.data.buyer,
  releases: [relA, relB],
  unitLoads: mixedLoads.map((load) => {
    const kind = palletKind(load, [relA, relB]);
    const di = palletLabelKind(kind);
    return {
      ...load,
      licencePlate: di ? buildLicencePlate(di, "55123", serial++) : null,
      cartons: load.cartons.map((carton) => ({
        ...carton,
        licencePlate: buildLicencePlate("1J", "55123", serial++)
      }))
    };
  })
};

const mixedLabels = labelsFromShipment(mixedShipment);
const palletLabel = mixedLabels.find((label) => label.kind === "5J");
const mixedOk =
  palletLabel != null &&
  !/(\(P\)|part no|PART NO)/i.test(palletLabel.zpl) &&
  !/\(Q\)/.test(palletLabel.zpl) &&
  !palletLabel.fields.part &&
  !palletLabel.fields.qty &&
  palletKind(mixedShipment.unitLoads[0], mixedShipment.releases) === "MIXED" &&
  cartonGroups(mixedShipment.unitLoads[0], mixedShipment.releases).length === 2;

console.log(`${mixedOk ? "ok" : "FAIL"}  case-2-5j-label-has-no-part-or-qty`);
if (!mixedOk) failed += 1;

if (failed > 0) {
  console.error(`\n${failed} Lucid packaging case(s) failed`);
  process.exit(1);
}

console.log("\nAll Lucid packaging must-pass cases passed");
