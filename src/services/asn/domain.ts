export const ASN_TRANSPORT_MODES = ["AIR", "SEA", "TRUCK", "PARCEL", "RAIL", "HAND_CARRY"] as const;
export const ASN_CARRIERS = [
  { name: "CH Robinson", scac: "RBTW" },
  { name: "DSV", scac: "DSVF" },
  { name: "DB Schenker (ocean)", scac: "GOLA" },
  { name: "DB Schenker (air)", scac: "SCNK" }
] as const;

export type AsnTransportMode = (typeof ASN_TRANSPORT_MODES)[number];
export type PalletKind = "HOMOGENEOUS" | "MIXED" | "LOOSE";
export type LabelKind = "1J" | "5J" | "6J";
export type LicenceDi = "1J" | "5J" | "6J";

export type AsnAddress = {
  code: string;
  name: string;
  street: string;
  city: string;
  zip: string;
  country: string;
};

export type AsnParty = {
  code: string;
  name: string;
};

export type AsnBuyer = {
  id: string;
  name: string;
};

export type AsnTurnaround = {
  partNo: string;
  description: string;
  shipTo: AsnAddress;
  shipFrom: AsnParty;
  buyer: AsnBuyer;
  poNumber: string;
  itemNumber: string;
  releaseNumber: string;
  price: string;
  uom: string;
};

export type SealedTurnaround = {
  data: AsnTurnaround;
  checksum: string;
};

export type AsnRelease = {
  id: string;
  scheduleId: string;
  turnaround: SealedTurnaround;
  deliveryDate: string;
  openQty: number;
  qtyToShip: number;
  partsPerCarton: number;
  cartonsPerPallet: number;
  unitWeightKg: number;
  countryOfOrigin: string;
  dateControlled: boolean;
  manufacturingDate: string;
  expirationDate: string;
};

export type AsnCarton = {
  id: string;
  releaseId: string;
  qty: number;
  short: boolean;
  licencePlate: string | null;
  grossWeightKg: number;
};

export type AsnUnitLoad = {
  id: string;
  mode: "PALLET" | "LOOSE";
  licencePlate: string | null;
  cartons: AsnCarton[];
};

export type AsnShipment = {
  asnNumber: string;
  shipDate: string;
  shipTime: string;
  transportMode: string;
  carrierScac: string;
  trackingNo: string;
  bolNumber: string;
  currentStep: number;
  labelsFrozen: boolean;
  shipFrom: AsnParty;
  shipTo: AsnAddress;
  buyer: AsnBuyer;
  releases: AsnRelease[];
  unitLoads: AsnUnitLoad[];
};

export type CartonGroup = {
  key: string;
  releaseId: string;
  partNo: string;
  ran: string;
  qtyPerCarton: number;
  cartons: AsnCarton[];
};

export function newAsnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `asn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function toKg(value: number, uom: string): number {
  const unit = uom.trim().toUpperCase();
  if (unit === "LB" || unit === "LBS") return Number((value * 0.45359237).toFixed(3));
  if (unit === "G" || unit === "GR") return Number((value / 1000).toFixed(3));
  return Number(value.toFixed(3));
}

export function toCm(value: number, uom: string): number {
  const unit = uom.trim().toUpperCase();
  if (unit === "IN" || unit === "INCH") return Number((value * 2.54).toFixed(2));
  if (unit === "M") return Number((value * 100).toFixed(2));
  if (unit === "FT" || unit === "FEET") return Number((value * 30.48).toFixed(2));
  return Number(value.toFixed(2));
}

export function canonicalizeTurnaround(data: AsnTurnaround): string {
  return JSON.stringify({
    partNo: data.partNo,
    description: data.description,
    shipTo: {
      code: data.shipTo.code,
      street: data.shipTo.street,
      city: data.shipTo.city,
      zip: data.shipTo.zip,
      country: data.shipTo.country
    },
    shipFrom: { code: data.shipFrom.code, name: data.shipFrom.name },
    buyer: { id: data.buyer.id, name: data.buyer.name },
    poNumber: data.poNumber,
    itemNumber: data.itemNumber,
    releaseNumber: data.releaseNumber,
    price: data.price,
    uom: data.uom
  });
}

export function palletKind(load: AsnUnitLoad, releases: AsnRelease[]): PalletKind {
  if (load.mode === "LOOSE") return "LOOSE";
  const parts = new Set(
    load.cartons.map((carton) => releaseById(releases, carton.releaseId)?.turnaround.data.partNo).filter(Boolean)
  );
  if (parts.size <= 1) return "HOMOGENEOUS";
  return "MIXED";
}

export function palletLabelKind(kind: PalletKind): LabelKind | null {
  if (kind === "HOMOGENEOUS") return "6J";
  if (kind === "MIXED") return "5J";
  return null;
}

export function releaseById(releases: AsnRelease[], id: string): AsnRelease | undefined {
  return releases.find((release) => release.id === id);
}

export function cartonGroups(load: AsnUnitLoad, releases: AsnRelease[]): CartonGroup[] {
  const groups = new Map<string, CartonGroup>();
  for (const carton of load.cartons) {
    const release = releaseById(releases, carton.releaseId);
    const ran = release?.turnaround.data.releaseNumber ?? carton.releaseId;
    const partNo = release?.turnaround.data.partNo ?? "";
    const key = `${ran}::${carton.qty}`;
    const current = groups.get(key) ?? {
      key,
      releaseId: carton.releaseId,
      partNo,
      ran,
      qtyPerCarton: carton.qty,
      cartons: []
    };
    current.cartons.push(carton);
    groups.set(key, current);
  }
  return [...groups.values()];
}

export function licencePlateDisplay(plate: string | null | undefined): {
  encoded: string;
  readable: string;
} {
  const encoded = (plate ?? "").trim();
  return { encoded, readable: encoded.length >= 2 ? encoded.slice(2) : encoded };
}

export function stripLeadingZeros(value: string): string {
  const stripped = value.replace(/^0+/, "");
  return stripped || "0";
}

export function buildLicencePlate(di: LicenceDi, shipFromCode: string, serial: number): string {
  const body = stripLeadingZeros(shipFromCode.replace(/[^A-Za-z0-9]/g, ""));
  const serialWidth = Math.max(1, 20 - 2 - body.length);
  const serialPart = String(Math.max(1, serial)).padStart(serialWidth, "0").slice(-serialWidth);
  return `${di}${body}${serialPart}`.slice(0, 20).padEnd(20, "0");
}

export function proposalText(releases: AsnRelease[]): string {
  const selected = releases.filter((release) => release.qtyToShip > 0);
  if (selected.length === 0) return "Enter quantities to ship, then packaging can be proposed.";
  return selected
    .map((release) => {
      const qty = release.qtyToShip;
      const ppc = Math.max(1, release.partsPerCarton);
      const cartonCount = Math.ceil(qty / ppc);
      const cpp = Math.max(1, release.cartonsPerPallet);
      const palletCount = cartonCount >= cpp ? Math.ceil(cartonCount / cpp) : 0;
      const part = release.turnaround.data.partNo;
      if (palletCount === 0) {
        return `${qty} pcs of ${part} → ${cartonCount} cartons × ${ppc} → loose (no pallet)`;
      }
      const kind = selected.length === 1 || new Set(selected.map((row) => row.turnaround.data.partNo)).size === 1
        ? "homogeneous"
        : "mixed";
      return `${qty} pcs of ${part} → ${cartonCount} cartons × ${ppc} → ${palletCount} ${kind} pallet${palletCount === 1 ? "" : "s"}`;
    })
    .join("\n");
}

export type PackagingAction =
  | { type: "addPallet" }
  | { type: "removePallet"; loadId: string }
  | { type: "addCarton"; loadId: string; releaseId: string; qty?: number }
  | { type: "removeCarton"; loadId: string; cartonId: string }
  | { type: "moveCarton"; fromLoadId: string; toLoadId: string; cartonId: string }
  | { type: "setCartonQty"; loadId: string; cartonId: string; qty: number }
  | { type: "markShort"; loadId: string; cartonId: string; short: boolean }
  | { type: "splitGroup"; loadId: string; groupKey: string; count: number; toReleaseId: string };

function cartonWeight(release: AsnRelease | undefined, qty: number): number {
  return Number((qty * (release?.unitWeightKg || 0)).toFixed(3));
}

function ensureLooseLoad(loads: AsnUnitLoad[]): AsnUnitLoad[] {
  if (loads.some((load) => load.mode === "LOOSE")) return loads;
  return [...loads, { id: newAsnId(), mode: "LOOSE", licencePlate: null, cartons: [] }];
}

export function applyPackagingAction(shipment: AsnShipment, action: PackagingAction): AsnShipment {
  if (shipment.labelsFrozen) return shipment;
  const loads = shipment.unitLoads.map((load) => ({ ...load, cartons: [...load.cartons] }));

  if (action.type === "addPallet") {
    return {
      ...shipment,
      unitLoads: [...loads, { id: newAsnId(), mode: "PALLET", licencePlate: null, cartons: [] }]
    };
  }

  if (action.type === "removePallet") {
    const removed = loads.find((load) => load.id === action.loadId);
    const remaining = loads.filter((load) => load.id !== action.loadId);
    if (!removed) return shipment;
    const next = ensureLooseLoad(remaining);
    const loose = next.find((load) => load.mode === "LOOSE");
    if (loose && removed.cartons.length > 0) {
      loose.cartons = [
        ...loose.cartons,
        ...removed.cartons.map((carton) => ({ ...carton, licencePlate: null }))
      ];
    }
    return {
      ...shipment,
      unitLoads: next.filter(
        (load) => load.mode === "PALLET" || load.cartons.length > 0 || next.length === 1
      )
    };
  }

  if (action.type === "addCarton") {
    const release = releaseById(shipment.releases, action.releaseId);
    if (!release) return shipment;
    const ppc = Math.max(1, release.partsPerCarton);
    const remaining = Math.max(0, release.qtyToShip - packedQtyForRelease(shipment, release.id));
    const qty = Math.max(1, Math.min(action.qty ?? ppc, remaining || ppc));
    const target = loads.find((load) => load.id === action.loadId);
    if (!target) return shipment;
    target.cartons.push({
      id: newAsnId(),
      releaseId: release.id,
      qty,
      short: qty < ppc,
      licencePlate: null,
      grossWeightKg: cartonWeight(release, qty)
    });
    return { ...shipment, unitLoads: loads };
  }

  if (action.type === "removeCarton") {
    return {
      ...shipment,
      unitLoads: loads.map((load) =>
        load.id === action.loadId
          ? { ...load, cartons: load.cartons.filter((carton) => carton.id !== action.cartonId) }
          : load
      )
    };
  }

  if (action.type === "moveCarton") {
    const from = loads.find((load) => load.id === action.fromLoadId);
    const to = loads.find((load) => load.id === action.toLoadId);
    if (!from || !to) return shipment;
    const index = from.cartons.findIndex((carton) => carton.id === action.cartonId);
    if (index < 0) return shipment;
    const [carton] = from.cartons.splice(index, 1);
    to.cartons.push({ ...carton, licencePlate: null });
    return { ...shipment, unitLoads: loads };
  }

  if (action.type === "setCartonQty") {
    const qty = Math.max(1, Math.floor(action.qty));
    return {
      ...shipment,
      unitLoads: loads.map((load) =>
        load.id !== action.loadId
          ? load
          : {
              ...load,
              cartons: load.cartons.map((carton) => {
                if (carton.id !== action.cartonId) return carton;
                const release = releaseById(shipment.releases, carton.releaseId);
                const ppc = Math.max(1, release?.partsPerCarton ?? qty);
                return {
                  ...carton,
                  qty,
                  short: qty < ppc || carton.short,
                  licencePlate: null,
                  grossWeightKg: cartonWeight(release, qty)
                };
              })
            }
      )
    };
  }

  if (action.type === "markShort") {
    return {
      ...shipment,
      unitLoads: loads.map((load) =>
        load.id !== action.loadId
          ? load
          : {
              ...load,
              cartons: load.cartons.map((carton) =>
                carton.id === action.cartonId
                  ? { ...carton, short: action.short, licencePlate: null }
                  : carton
              )
            }
      )
    };
  }

  if (action.type === "splitGroup") {
    const load = loads.find((row) => row.id === action.loadId);
    const targetRelease = releaseById(shipment.releases, action.toReleaseId);
    if (!load || !targetRelease) return shipment;
    const groups = cartonGroups(load, shipment.releases);
    const group = groups.find((row) => row.key === action.groupKey);
    if (!group) return shipment;
    const moving = group.cartons.slice(-Math.max(0, action.count));
    const movingIds = new Set(moving.map((carton) => carton.id));
    load.cartons = load.cartons.map((carton) => {
      if (!movingIds.has(carton.id)) return carton;
      const ppc = Math.max(1, targetRelease.partsPerCarton);
      return {
        ...carton,
        releaseId: targetRelease.id,
        short: carton.qty < ppc,
        licencePlate: null,
        grossWeightKg: cartonWeight(targetRelease, carton.qty)
      };
    });
    return { ...shipment, unitLoads: loads };
  }

  return shipment;
}

export function proposePackaging(releases: AsnRelease[]): AsnUnitLoad[] {
  const selected = releases.filter((release) => release.qtyToShip > 0);
  const built: AsnCarton[] = [];
  for (const release of selected) {
    const ppc = Math.max(1, release.partsPerCarton);
    let remaining = Math.max(0, Math.floor(release.qtyToShip));
    while (remaining > 0) {
      const qty = Math.min(ppc, remaining);
      built.push({
        id: newAsnId(),
        releaseId: release.id,
        qty,
        short: qty < ppc,
        licencePlate: null,
        grossWeightKg: Number((qty * (release.unitWeightKg || 0)).toFixed(3))
      });
      remaining -= qty;
    }
  }

  if (built.length === 0) {
    return [{ id: newAsnId(), mode: "LOOSE", licencePlate: null, cartons: [] }];
  }

  const cpp = Math.max(1, ...selected.map((release) => release.cartonsPerPallet || 9));
  if (built.length < cpp) {
    if (built.length >= cpp - 1) {
      fillCartonCount(built, cpp, selected);
      return [{ id: newAsnId(), mode: "PALLET", licencePlate: null, cartons: built }];
    }
    return [{ id: newAsnId(), mode: "LOOSE", licencePlate: null, cartons: built }];
  }

  const loads: AsnUnitLoad[] = [];
  for (let index = 0; index < built.length; index += cpp) {
    loads.push({
      id: newAsnId(),
      mode: "PALLET",
      licencePlate: null,
      cartons: built.slice(index, index + cpp)
    });
  }
  return loads;
}

function fillCartonCount(built: AsnCarton[], target: number, releases: AsnRelease[]): void {
  while (built.length < target) {
    const index = built.findIndex((carton) => carton.qty >= 2);
    if (index < 0) return;
    const carton = built[index];
    const release = releaseById(releases, carton.releaseId);
    const ppc = Math.max(1, release?.partsPerCarton ?? carton.qty);
    const left = Math.floor(carton.qty / 2);
    const right = carton.qty - left;
    const split = (qty: number): AsnCarton => ({
      id: newAsnId(),
      releaseId: carton.releaseId,
      qty,
      short: qty < ppc,
      licencePlate: null,
      grossWeightKg: Number((qty * (release?.unitWeightKg || 0)).toFixed(3))
    });
    built.splice(index, 1, split(left), split(right));
  }
}

export function shipmentTotals(shipment: AsnShipment) {
  const cartons = shipment.unitLoads.flatMap((load) => load.cartons);
  const pallets = shipment.unitLoads.filter((load) => load.mode === "PALLET" && load.cartons.length > 0);
  const perPart = new Map<string, number>();
  for (const carton of cartons) {
    const part = releaseById(shipment.releases, carton.releaseId)?.turnaround.data.partNo ?? "UNKNOWN";
    perPart.set(part, (perPart.get(part) ?? 0) + carton.qty);
  }
  const grossWeightKg = cartons.reduce((sum, carton) => sum + carton.grossWeightKg, 0);
  const netWeightKg = grossWeightKg;
  return {
    cartonCount: cartons.length,
    palletCount: pallets.length,
    piecesPerPart: [...perPart.entries()].map(([partNo, qty]) => ({ partNo, qty })),
    grossWeightKg: Number(grossWeightKg.toFixed(3)),
    netWeightKg: Number(netWeightKg.toFixed(3))
  };
}

export function packedQtyForRelease(shipment: AsnShipment, releaseId: string): number {
  return shipment.unitLoads
    .flatMap((load) => load.cartons)
    .filter((carton) => carton.releaseId === releaseId)
    .reduce((sum, carton) => sum + carton.qty, 0);
}

export function conflictingShipTo(shipment: AsnShipment): boolean {
  const selected = shipment.releases.filter((release) => release.qtyToShip > 0);
  if (selected.length <= 1) return false;
  const key = (release: AsnRelease) =>
    JSON.stringify({
      code: release.turnaround.data.shipTo.code,
      street: release.turnaround.data.shipTo.street,
      city: release.turnaround.data.shipTo.city,
      zip: release.turnaround.data.shipTo.zip,
      country: release.turnaround.data.shipTo.country
    });
  const first = key(selected[0]);
  return selected.some((release) => key(release) !== first);
}

export type AsnValidationIssue = { blocking: boolean; message: string };

export function validateShipment(
  shipment: AsnShipment,
  checksumOk: boolean,
  usedPlates: Set<string>
): AsnValidationIssue[] {
  const issues: AsnValidationIssue[] = [];
  const totals = shipmentTotals(shipment);
  const selected = shipment.releases.filter((release) => release.qtyToShip > 0);

  if (!checksumOk) {
    issues.push({ blocking: true, message: "Turnaround checksum no longer matches the inbound release." });
  }
  if (conflictingShipTo(shipment)) {
    issues.push({ blocking: true, message: "Selected releases disagree on ship-to. Use one ship-to per ASN." });
  }
  if (!shipment.transportMode.trim()) {
    issues.push({ blocking: true, message: "Transport mode is required." });
  }
  if (!shipment.carrierScac.trim()) {
    issues.push({ blocking: true, message: "Carrier SCAC is required." });
  }
  if (!shipment.trackingNo.trim()) {
    issues.push({ blocking: true, message: "Tracking number is required." });
  }
  if (shipment.asnNumber.trim() && shipment.trackingNo.trim() && shipment.asnNumber === shipment.trackingNo) {
    issues.push({ blocking: true, message: "ASN number must not equal the tracking number." });
  }

  const plates: string[] = [];
  for (const load of shipment.unitLoads) {
    const kind = palletKind(load, shipment.releases);
    if (load.mode === "PALLET" && load.cartons.length > 0 && !load.licencePlate) {
      issues.push({ blocking: true, message: "Every non-loose pallet must have a licence plate." });
    }
    if (load.licencePlate) plates.push(load.licencePlate);
    for (const carton of load.cartons) {
      if (!carton.licencePlate) {
        issues.push({ blocking: true, message: "Every carton must have a licence plate." });
      } else {
        plates.push(carton.licencePlate);
      }
      const release = releaseById(shipment.releases, carton.releaseId);
      const ppc = Math.max(1, release?.partsPerCarton ?? carton.qty);
      if (carton.qty > ppc && !carton.short) {
        issues.push({
          blocking: true,
          message: `Carton qty ${carton.qty} exceeds parts-per-carton ${ppc} and is not flagged short.`
        });
      }
      if (release && carton.qty < ppc && !carton.short) {
        issues.push({
          blocking: true,
          message: `Carton below standard pack of ${ppc} must be flagged short.`
        });
      }
      if ((release?.turnaround.data.description.length ?? 0) > 40) {
        issues.push({ blocking: true, message: "Description must be 40 characters or fewer." });
      }
      if (release?.dateControlled) {
        if (!release.manufacturingDate && !release.expirationDate) {
          issues.push({
            blocking: true,
            message: `Date-controlled part ${release.turnaround.data.partNo} is missing DOM/DOE.`
          });
        }
      }
    }
    if (kind === "MIXED" && load.licencePlate && !load.licencePlate.startsWith("5J")) {
      issues.push({ blocking: true, message: "Mixed pallets must use a 5J licence plate." });
    }
    if (kind === "HOMOGENEOUS" && load.licencePlate && !load.licencePlate.startsWith("6J")) {
      issues.push({ blocking: true, message: "Homogeneous pallets must use a 6J licence plate." });
    }
  }

  const unique = new Set(plates);
  if (unique.size !== plates.length) {
    issues.push({ blocking: true, message: "Licence plates must be unique in the shipment." });
  }
  for (const plate of unique) {
    if (usedPlates.has(plate)) {
      issues.push({ blocking: true, message: `Licence plate ${plate} was already used.` });
    }
    if (plate.length !== 20) {
      issues.push({ blocking: true, message: `Licence plate ${plate} must be exactly 20 characters.` });
    }
  }

  for (const release of selected) {
    const packed = packedQtyForRelease(shipment, release.id);
    if (packed !== release.qtyToShip) {
      issues.push({
        blocking: true,
        message: `Packed qty for RAN ${release.turnaround.data.releaseNumber} is ${packed}, declared ${release.qtyToShip}.`
      });
    }
    if (packed > release.openQty) {
      issues.push({
        blocking: false,
        message: `Over-ship: RAN ${release.turnaround.data.releaseNumber} open ${release.openQty}, shipping ${packed}.`
      });
    } else if (packed < release.openQty && packed > 0) {
      issues.push({
        blocking: false,
        message: `Under-ship: RAN ${release.turnaround.data.releaseNumber} open ${release.openQty}, shipping ${packed}.`
      });
    }
  }

  if (totals.cartonCount === 0) {
    issues.push({ blocking: true, message: "ASN has no packed cartons." });
  }

  return issues;
}

function sampleRelease(params: {
  id: string;
  partNo: string;
  ran: string;
  qty: number;
  ppc: number;
  cpp: number;
}): AsnRelease {
  const turnaround: AsnTurnaround = {
    partNo: params.partNo,
    description: params.partNo.slice(0, 40),
    shipTo: {
      code: "LC001",
      name: "Lucid",
      street: "1 Alameda",
      city: "Casa Grande",
      zip: "85122",
      country: "US"
    },
    shipFrom: { code: "00055123", name: "Supplier" },
    buyer: { id: "LUCID", name: "Lucid Motors" },
    poNumber: "PO-1",
    itemNumber: "001",
    releaseNumber: params.ran,
    price: "10.00",
    uom: "EA"
  };
  return {
    id: params.id,
    scheduleId: "sched",
    turnaround: { data: turnaround, checksum: "test" },
    deliveryDate: "2026-08-10",
    openQty: params.qty,
    qtyToShip: params.qty,
    partsPerCarton: params.ppc,
    cartonsPerPallet: params.cpp,
    unitWeightKg: 0.5,
    countryOfOrigin: "US",
    dateControlled: false,
    manufacturingDate: "",
    expirationDate: ""
  };
}

export function lucidPackagingCaseResults(): Array<{ name: string; ok: boolean; detail: string }> {
  const cases: Array<{ name: string; ok: boolean; detail: string }> = [];

  const case1Loads = proposePackaging([
    sampleRelease({ id: "r1", partNo: "P11-12345-00", ran: "RAN-103014", qty: 90, ppc: 10, cpp: 9 })
  ]);
  const case1Cartons = case1Loads.flatMap((load) => load.cartons);
  const case1Groups = case1Loads.flatMap((load) =>
    cartonGroups(load, [
      sampleRelease({ id: "r1", partNo: "P11-12345-00", ran: "RAN-103014", qty: 90, ppc: 10, cpp: 9 })
    ])
  );
  cases.push({
    name: "case-1-homogeneous-9x10",
    ok:
      case1Loads.length === 1 &&
      case1Loads[0].mode === "PALLET" &&
      palletKind(case1Loads[0], [
        sampleRelease({ id: "r1", partNo: "P11-12345-00", ran: "RAN-103014", qty: 90, ppc: 10, cpp: 9 })
      ]) === "HOMOGENEOUS" &&
      palletLabelKind(
        palletKind(case1Loads[0], [
          sampleRelease({ id: "r1", partNo: "P11-12345-00", ran: "RAN-103014", qty: 90, ppc: 10, cpp: 9 })
        ])
      ) === "6J" &&
      case1Cartons.length === 9 &&
      case1Groups.length === 1,
    detail: `${case1Loads.length} loads, ${case1Cartons.length} cartons, ${case1Groups.length} groups`
  });

  const a = sampleRelease({ id: "ra", partNo: "P11-AAAAA-00", ran: "RAN-A", qty: 80, ppc: 10, cpp: 10 });
  const b = sampleRelease({ id: "rb", partNo: "P11-BBBBB-00", ran: "RAN-B", qty: 20, ppc: 10, cpp: 10 });
  const case2Loads = proposePackaging([a, b]);
  const case2Kind = palletKind(case2Loads[0], [a, b]);
  const case2Groups = cartonGroups(case2Loads[0], [a, b]);
  cases.push({
    name: "case-2-mixed-5j-no-part-on-pallet-label",
    ok:
      case2Loads.length === 1 &&
      case2Kind === "MIXED" &&
      palletLabelKind(case2Kind) === "5J" &&
      case2Groups.length === 2 &&
      case2Loads[0].cartons.length === 10,
    detail: `${case2Kind} ${palletLabelKind(case2Kind)} groups=${case2Groups.length}`
  });

  const case3Rel = sampleRelease({
    id: "r3",
    partNo: "P11-98765-00",
    ran: "RAN-303021",
    qty: 15,
    ppc: 5,
    cpp: 9
  });
  const case3Loads = proposePackaging([case3Rel]);
  cases.push({
    name: "case-3-loose-no-pallet-lp",
    ok:
      case3Loads.length === 1 &&
      case3Loads[0].mode === "LOOSE" &&
      palletKind(case3Loads[0], [case3Rel]) === "LOOSE" &&
      case3Loads[0].cartons.length === 3 &&
      case3Loads[0].licencePlate === null,
    detail: `${case3Loads[0].mode} cartons=${case3Loads[0].cartons.length}`
  });

  const case4Rel = sampleRelease({
    id: "r4",
    partNo: "P11-12345-00",
    ran: "RAN-103014",
    qty: 75,
    ppc: 10,
    cpp: 9
  });
  const case4Loads = proposePackaging([case4Rel]);
  const case4Groups = cartonGroups(case4Loads[0], [case4Rel]);
  cases.push({
    name: "case-4-two-pack-sizes",
    ok:
      case4Loads.length === 1 &&
      case4Loads[0].mode === "PALLET" &&
      palletKind(case4Loads[0], [case4Rel]) === "HOMOGENEOUS" &&
      case4Loads[0].cartons.filter((carton) => carton.qty === 10).length === 6 &&
      case4Loads[0].cartons.filter((carton) => carton.qty === 5).length === 3 &&
      case4Groups.length === 2,
    detail: `groups=${case4Groups.length} cartons=${case4Loads[0].cartons.length}`
  });

  const ranA = sampleRelease({
    id: "r5a",
    partNo: "P11-12345-00",
    ran: "RAN-A",
    qty: 70,
    ppc: 10,
    cpp: 9
  });
  const ranB = sampleRelease({
    id: "r5b",
    partNo: "P11-12345-00",
    ran: "RAN-B",
    qty: 20,
    ppc: 10,
    cpp: 9
  });
  const case5Loads = proposePackaging([ranA, ranB]);
  const case5Kind = palletKind(case5Loads[0], [ranA, ranB]);
  const case5Groups = cartonGroups(case5Loads[0], [ranA, ranB]);
  cases.push({
    name: "case-5-one-part-two-rans-still-6j",
    ok:
      case5Loads.length === 1 &&
      case5Kind === "HOMOGENEOUS" &&
      palletLabelKind(case5Kind) === "6J" &&
      case5Groups.length === 2 &&
      case5Loads[0].cartons.length === 9,
    detail: `${case5Kind} groups=${case5Groups.length}`
  });

  return cases;
}
