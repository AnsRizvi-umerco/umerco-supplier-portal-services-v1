import {
  licencePlateDisplay,
  palletKind,
  palletLabelKind,
  shipmentTotals,
  type AsnCarton,
  type AsnShipment,
  type AsnUnitLoad,
  type LabelKind
} from "@/services/asn/domain";

function zplText(value: string): string {
  return value.replace(/[\^~\\]/g, " ").slice(0, 60);
}

function plateLines(plate: string | null): { encoded: string; readable: string } {
  return licencePlateDisplay(plate);
}

function cartonZpl(shipment: AsnShipment, load: AsnUnitLoad, carton: AsnCarton, index: number): string {
  const release = shipment.releases.find((row) => row.id === carton.releaseId);
  const data = release?.turnaround.data;
  const plate = plateLines(carton.licencePlate);
  const shipTo = data?.shipTo ?? shipment.shipTo;
  const shipFrom = data?.shipFrom ?? shipment.shipFrom;
  const dateStrip =
    release?.dateControlled && (release.expirationDate || release.manufacturingDate)
      ? `^FO760,40^GB24,520,24^FS
^FO766,60^A0B,22,22^FR^FD(5D) Expiration Date ${zplText(release.expirationDate || "")}^FS`
      : "";

  return `^XA
^PW812
^LL1218
^FO40,40^A0N,28,28^FD(P) ${zplText(data?.partNo || "")}^FS
^FO40,80^A0N,24,24^FD(Q) ${carton.qty} ${zplText(data?.uom || "EA")}^FS
^FO40,120^A0N,22,22^FD${zplText((data?.description || "").slice(0, 40))}^FS
^FO40,170^A0N,24,24^FD(1J) ${zplText(plate.readable)}^FS
^FO40,210^BY2,3,80^BCN,80,N,N,N^FD${zplText(plate.encoded)}^FS
^FO40,300^A0N,20,20^FD${zplText(plate.readable)}^FS
^FO40,340^A0N,22,22^FD(K) ${zplText(data?.poNumber || "")}^FS
^FO40,380^A0N,22,22^FDBox ${index + 1}^FS
^FO40,420^A0N,22,22^FDGross ${carton.grossWeightKg} KG^FS
^FO40,460^A0N,22,22^FDCOO ${zplText(release?.countryOfOrigin || "")}^FS
${release?.dateControlled && release.manufacturingDate ? `^FO40,500^A0N,22,22^FD(6D) ${zplText(release.manufacturingDate)}^FS` : ""}
^FO40,560^A0N,20,20^FDShip-to ${zplText(shipTo.code)} ${zplText(shipTo.city)} ${zplText(shipTo.zip)}^FS
^FO40,600^A0N,20,20^FDShip-from ${zplText(shipFrom.code)} ${zplText(shipFrom.name)}^FS
${dateStrip}
^XZ
^FX TODO(lucid-spec): 2D barcode payload and symbology
^FX TODO(lucid-spec): label stock dimensions and quiet zones
^FX TODO(lucid-spec): whether the "BOX n OF m" denominator is per-part, per-pallet or per-shipment`;
}

function masterZpl(shipment: AsnShipment, load: AsnUnitLoad): string {
  const kind = palletKind(load, shipment.releases);
  const labelKind = palletLabelKind(kind);
  const plate = plateLines(load.licencePlate);
  const totals = load.cartons.reduce((sum, carton) => sum + carton.qty, 0);
  const first = shipment.releases.find((row) => row.id === load.cartons[0]?.releaseId);
  const data = first?.turnaround.data;
  const shipTo = data?.shipTo ?? shipment.shipTo;
  const shipFrom = data?.shipFrom ?? shipment.shipFrom;

  if (labelKind === "5J") {
    return `^XA
^PW812
^LL1218
^FO40,40^A0N,48,48^FDMIXED LOAD^FS
^FO40,110^A0N,28,28^FD(5J) ${zplText(plate.readable)}^FS
^FO40,160^BY3,3,120^BCN,120,N,N,N^FD${zplText(plate.encoded)}^FS
^FO40,300^A0N,24,24^FD${zplText(plate.readable)}^FS
^FO40,360^A0N,24,24^FD(V) ${zplText(shipFrom.code)}^FS
^FO40,410^A0N,24,24^FDShip date ${zplText(shipment.shipDate)}^FS
^FO40,460^A0N,22,22^FDShip-to ${zplText(shipTo.code)} ${zplText(shipTo.street)}^FS
^FO40,500^A0N,22,22^FD${zplText(shipTo.city)} ${zplText(shipTo.zip)} ${zplText(shipTo.country)}^FS
^FO40,560^A0N,22,22^FDShip-from ${zplText(shipFrom.code)} ${zplText(shipFrom.name)}^FS
^XZ
^FX TODO(lucid-spec): 2D barcode payload and symbology
^FX TODO(lucid-spec): label stock dimensions and quiet zones`;
  }

  return `^XA
^PW812
^LL1218
^FO40,40^A0N,28,28^FD(P) ${zplText(data?.partNo || "")}^FS
^FO40,80^A0N,24,24^FD(Q) ${totals} ${zplText(data?.uom || "EA")}^FS
^FO40,120^A0N,28,28^FDMASTER LABEL^FS
^FO40,170^A0N,24,24^FD(6J) ${zplText(plate.readable)}^FS
^FO40,210^BY2,3,80^BCN,80,N,N,N^FD${zplText(plate.encoded)}^FS
^FO40,300^A0N,20,20^FD${zplText(plate.readable)}^FS
^FO40,340^A0N,22,22^FD(K) ${zplText(data?.poNumber || "")}^FS
^FO40,380^A0N,22,22^FD${load.cartons.length} BOXES^FS
^FO40,420^A0N,22,22^FDGross ${load.cartons.reduce((sum, carton) => sum + carton.grossWeightKg, 0)} KG^FS
^FO40,460^A0N,22,22^FDCOO ${zplText(first?.countryOfOrigin || "")}^FS
^FO40,560^A0N,20,20^FDShip-to ${zplText(shipTo.code)} ${zplText(shipTo.city)} ${zplText(shipTo.zip)}^FS
^FO40,600^A0N,20,20^FDShip-from ${zplText(shipFrom.code)} ${zplText(shipFrom.name)}^FS
^XZ
^FX TODO(lucid-spec): 2D barcode payload and symbology
^FX TODO(lucid-spec): label stock dimensions and quiet zones`;
}

export type AsnLabelArtifact = {
  id: string;
  kind: LabelKind;
  title: string;
  licencePlate: string;
  readable: string;
  zpl: string;
  fields: Record<string, string>;
};

export function labelsFromShipment(shipment: AsnShipment): AsnLabelArtifact[] {
  const labels: AsnLabelArtifact[] = [];
  for (const load of shipment.unitLoads) {
    const kind = palletKind(load, shipment.releases);
    const palletLabel = palletLabelKind(kind);
    if (palletLabel && load.licencePlate) {
      const plate = plateLines(load.licencePlate);
      labels.push({
        id: `${load.id}-${palletLabel}`,
        kind: palletLabel,
        title: palletLabel === "5J" ? "Mixed load pallet" : "Master pallet",
        licencePlate: plate.encoded,
        readable: plate.readable,
        zpl: masterZpl(shipment, load),
        fields:
          palletLabel === "5J"
            ? {
                type: "MIXED LOAD",
                plate: plate.readable,
                supplier: shipment.shipFrom.code,
                shipDate: shipment.shipDate,
                shipTo: shipment.shipTo.code,
                shipFrom: shipment.shipFrom.code
              }
            : {
                type: "MASTER LABEL",
                part: shipment.releases.find((row) => row.id === load.cartons[0]?.releaseId)?.turnaround.data.partNo || "",
                qty: String(load.cartons.reduce((sum, carton) => sum + carton.qty, 0)),
                boxes: `${load.cartons.length} BOXES`,
                plate: plate.readable
              }
      });
    }

    load.cartons.forEach((carton, index) => {
      const plate = plateLines(carton.licencePlate);
      const release = shipment.releases.find((row) => row.id === carton.releaseId);
      labels.push({
        id: carton.id,
        kind: "1J",
        title: "Carton",
        licencePlate: plate.encoded,
        readable: plate.readable,
        zpl: cartonZpl(shipment, load, carton, index),
        fields: {
          part: release?.turnaround.data.partNo || "",
          qty: String(carton.qty),
          description: release?.turnaround.data.description || "",
          plate: plate.readable,
          po: release?.turnaround.data.poNumber || "",
          ran: release?.turnaround.data.releaseNumber || ""
        }
      });
    });
  }
  return labels;
}

export function shipmentSummary(shipment: AsnShipment) {
  return {
    asnNumber: shipment.asnNumber,
    totals: shipmentTotals(shipment),
    loads: shipment.unitLoads.map((load) => ({
      id: load.id,
      mode: load.mode,
      kind: palletKind(load, shipment.releases),
      labelKind: palletLabelKind(palletKind(load, shipment.releases)),
      licencePlate: load.licencePlate,
      cartonCount: load.cartons.length,
      qty: load.cartons.reduce((sum, carton) => sum + carton.qty, 0)
    }))
  };
}
