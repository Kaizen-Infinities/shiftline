import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import type { ChallanPrintData } from "../../templates/deliveryChallanTemplate";
import { requireTenantId } from "../../lib/tenant-context";

/**
 * Gathers what the delivery challan prints (P1-14). The e-way bill is looked up by the challan's
 * own number rather than stored on it: a bill is raised from the document, and a document can
 * outlive a cancelled bill, so the live one is whatever `eway_bills` currently says.
 */
export const challanPrintData = async (id: string): Promise<ChallanPrintData> => {
  const challan = await prisma.deliveryChallan.findUnique({
    where: { id },
    include: { items: true, jobWorker: true, businessPlace: true },
  });
  if (!challan) throw new ApiError(404, "That challan does not exist");
  const company = await prisma.company.findFirstOrThrow({ where: { id: requireTenantId() } });

  const ewayBill = await prisma.ewayBill.findFirst({
    where: { docType: "CHL", docRef: challan.id, status: { in: ["ACTIVE", "PENDING"] } },
    orderBy: { createdAt: "desc" },
    select: { ewbNo: true, validUpto: true },
  });

  const address = (a: unknown) => {
    if (!a || typeof a !== "object") return null;
    const v = a as Record<string, string | undefined>;
    return (
      [v.addressLine1 ?? v.line1, v.city, v.state, v.pincode].filter(Boolean).join(", ") || null
    );
  };

  return {
    challanNo: challan.challanNo,
    challanDate: challan.challanDate,
    kind: challan.kind,
    purpose: challan.purpose,
    returnDueDate: challan.returnDueDate,
    capitalGoods: challan.capitalGoods,
    taxable: Number(challan.taxable),
    igst: Number(challan.igst),
    cgst: Number(challan.cgst),
    sgst: Number(challan.sgst),
    totalValue: Number(challan.totalValue),
    transporterName: challan.transporterName,
    vehicleNumber: challan.vehicleNumber,
    remarks: challan.remarks,
    items: challan.items.map((i) => ({
      description: i.description ?? i.rawMaterialId ?? "",
      hsnCode: i.hsnCode,
      uom: i.uom,
      quantitySent: Number(i.quantitySent),
      rate: Number(i.rate),
      taxableAmount: Number(i.taxableAmount),
    })),
    company: {
      name: company.legalName ?? company.companyName,
      address: address(challan.businessPlace?.address) ?? null,
      gstin: challan.businessPlace?.gstin ?? company.gstin,
    },
    consignee: {
      name: challan.jobWorker?.name ?? challan.purpose ?? "—",
      gstin: challan.jobWorker?.gstin ?? null,
      address: [
        challan.jobWorker?.addressLine1,
        challan.jobWorker?.city,
        challan.jobWorker?.pincode,
      ]
        .filter(Boolean)
        .join(", "),
    },
    ewayBillNo: ewayBill?.ewbNo ?? null,
    ewayBillValidUpto: ewayBill?.validUpto ?? null,
  };
};
