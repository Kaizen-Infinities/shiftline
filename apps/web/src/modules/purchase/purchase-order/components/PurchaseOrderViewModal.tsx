import React, { useEffect, useMemo } from "react";
import type { PurchaseOrder } from "../../../../features/purchaseOrder/types";
import { useSelector, useDispatch } from "react-redux";
import { fetchRawMaterials } from "../../../../features/raw-materials/rawMaterialSlice";
import type { AppDispatch } from "../../../../app/store";
import CommonViewModal from "../../../../components/ui/CommonViewModal/CommonViewModal";
import StatusBadge from "../../../../components/ui/StatusBadge/Badge";
import { Chip } from "../../../../components/ui/v2";
import { formatINR } from "../../../sales/shared/tradeUi";
import { useUsers } from "../../../../hooks/useUsers";

import { getUomMultiplier } from "../pages/PurchaseOrderForm";

interface PurchaseOrderViewModalProps {
  show: boolean;
  onHide: () => void;
  purchaseOrder: PurchaseOrder | null;
}

const safeDate = (date?: string | null) => {
  if (!date) return "-";
  const d = new Date(date);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
};

const safeNumber = (val: any): number => {
  if (val === null || val === undefined || val === "") return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
};

const PurchaseOrderViewModal: React.FC<PurchaseOrderViewModalProps> = ({
  show,
  onHide,
  purchaseOrder,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const rawMaterials = useSelector((state: any) => state.rawMaterials?.data || []);
  const user = useSelector((state: any) => state?.auth?.user);
  const { users, loadUsers } = useUsers();
  const company = useSelector((state: any) => state.company?.data);
  const companyState = company?.state;

  useEffect(() => {
    if (show) {
      if (rawMaterials.length === 0) {
        dispatch(fetchRawMaterials(undefined));
      }
      loadUsers();
    }
  }, [show, dispatch, rawMaterials.length, loadUsers]);

  if (!purchaseOrder) return null;

  const createdByUser = users.find(
    (u: any) => u.userId === purchaseOrder.createdBy || u.id === purchaseOrder.createdBy
  );
  const createdByName =
    createdByUser?.username ||
    (purchaseOrder.createdBy?.startsWith("admin_") ? "admin" : purchaseOrder.createdBy || "NA");

  const isInterState =
    companyState && purchaseOrder.billingState
      ? companyState.toLowerCase().trim() !== purchaseOrder.billingState.toLowerCase().trim()
      : Number(purchaseOrder.totalIgst) > 0;

  const sections = [
    {
      title: "Order Information",
      fields: [
        { label: "PO Date", value: safeDate(purchaseOrder.poDate) },
        { label: "Expected Delivery", value: safeDate(purchaseOrder.expectedDeliveryDate) },
        {
          label: "Supplier",
          value:
            purchaseOrder.supplier?.displayName ||
            purchaseOrder.supplier?.legalName ||
            purchaseOrder.supplier?.supplierName ||
            "N/A",
        },
        { label: "Supplier Code", value: purchaseOrder.supplier?.supplierCode || "N/A" },
      ],
    },
    {
      title: "Addresses",
      fields: [
        {
          // E2E-B09: the supplier's address, so the PO can be sent to them. Bill-To stays our company.
          label: "Supplier Address",
          value: purchaseOrder.supplier?.billingAddressLine1 ? (
            <>
              {purchaseOrder.supplier.billingAddressLine1} <br />
              {purchaseOrder.supplier.billingCity || "-"},{" "}
              {purchaseOrder.supplier.billingState || "-"} <br />
              {purchaseOrder.supplier.billingPincode || "-"}
            </>
          ) : (
            "-"
          ),
        },
        {
          label: "Billing Address",
          value: (
            <>
              {purchaseOrder.billingAddressLine1 || "-"} <br />
              {purchaseOrder.billingCity || "-"}, {purchaseOrder.billingState || "-"} <br />
              {purchaseOrder.billingPincode || "-"}
            </>
          ),
        },
        {
          label: "Shipping Address",
          value: (
            <>
              {purchaseOrder.shippingAddressLine1 || "-"} <br />
              {purchaseOrder.shippingCity || "-"}, {purchaseOrder.shippingState || "-"} <br />
              {purchaseOrder.shippingPincode || "-"}
              {purchaseOrder.sameAsBilling && (
                <div className="mt-1">
                  <Chip size="sm" tone="muted">
                    Same as billing
                  </Chip>
                </div>
              )}
            </>
          ),
        },
      ],
    },
  ];

  if (purchaseOrder.remarks) {
    sections.push({
      title: "Remarks",
      fields: [{ label: "Notes", value: purchaseOrder.remarks }],
    });
  }

  if (purchaseOrder.status === "REJECTED" && purchaseOrder.rejectReason) {
    sections.push({
      title: "Rejection Reason",
      fields: [
        {
          label: "Reason",
          value: (
            <span className="font-semibold text-[color:var(--color-danger)]">
              {purchaseOrder.rejectReason}
            </span>
          ),
        },
      ],
    });
  }

  sections.push({
    title: "Timestamps",
    fields: [
      { label: "Created By", value: createdByName },
      { label: "Created At", value: safeDate(purchaseOrder.createdAt) },
    ],
  });

  const customContent = (
    <div className="sl-tile overflow-hidden">
      <div className="border-b border-line-soft px-5 py-3">
        <h3 className="sl-h2 m-0">Items</h3>
      </div>
      <div className="p-0 overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-line-soft bg-card-2">
              <th scope="col" className="sl-th px-4 py-2.5 text-left">
                S.No
              </th>
              <th scope="col" className="sl-th px-4 py-2.5 text-left">
                Product
              </th>
              <th scope="col" className="sl-th px-4 py-2.5 text-right">
                Qty
              </th>
              <th scope="col" className="sl-th px-4 py-2.5 text-right">
                Unit Price
              </th>
              <th scope="col" className="sl-th px-4 py-2.5 text-right">
                Tax %
              </th>
              {isInterState ? (
                <th scope="col" className="sl-th px-4 py-2.5 text-right">
                  IGST
                </th>
              ) : (
                <>
                  <th scope="col" className="sl-th px-4 py-2.5 text-right">
                    CGST
                  </th>
                  <th scope="col" className="sl-th px-4 py-2.5 text-right">
                    SGST
                  </th>
                </>
              )}
              <th scope="col" className="sl-th px-4 py-2.5 text-right">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft text-sm text-ink">
            {(purchaseOrder.items || []).length > 0 ? (
              purchaseOrder.items.map((item, index) => {
                const qty = safeNumber(item.quantity);
                const price = safeNumber(item.unitPrice);
                const tax = safeNumber(item.tax);

                const base = qty * price;
                const taxAmt = (base * tax) / 100;
                const total = item.lineTotal ? safeNumber(item.lineTotal) : base + taxAmt;

                const cgstAmt =
                  item.cgstAmount !== undefined ? safeNumber(item.cgstAmount) : taxAmt / 2;
                const sgstAmt =
                  item.sgstAmount !== undefined ? safeNumber(item.sgstAmount) : taxAmt / 2;
                const igstAmt =
                  item.igstAmount !== undefined ? safeNumber(item.igstAmount) : taxAmt;

                const matchedMaterial = rawMaterials.find(
                  (rm: any) => String(rm.rawMaterialId) === String(item.productId)
                );
                const productName =
                  matchedMaterial?.materialName || `Product #${item.productId || "-"}`;

                return (
                  <tr key={item.id || index}>
                    <td className="p-4">{index + 1}</td>
                    <td className="p-4 font-medium text-ink">{productName}</td>
                    <td className="p-4 text-right tabular-nums">{qty}</td>
                    <td className="p-4 text-right tabular-nums">{formatINR(price)}</td>
                    <td className="p-4 text-right tabular-nums">{tax}%</td>
                    {isInterState ? (
                      <td className="p-4 text-right tabular-nums">{formatINR(igstAmt)}</td>
                    ) : (
                      <>
                        <td className="p-4 text-right tabular-nums">{formatINR(cgstAmt)}</td>
                        <td className="p-4 text-right tabular-nums">{formatINR(sgstAmt)}</td>
                      </>
                    )}
                    <td className="p-4 text-right font-semibold tabular-nums">
                      {formatINR(total)}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={8} className="p-8 text-center text-ink-subtle">
                  No items found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end border-t border-line-soft bg-card-2 p-5">
        <div className="w-full sm:w-1/2 lg:w-1/3 space-y-2 text-sm">
          <div className="flex justify-between text-ink-muted">
            <span>Subtotal:</span>
            <span>{formatINR(safeNumber(purchaseOrder.subtotal))}</span>
          </div>
          <div className="flex justify-between text-ink-muted">
            <span>Discount:</span>
            <span>-{formatINR(safeNumber(purchaseOrder.totalDiscount))}</span>
          </div>
          {/* <div className="flex justify-between text-ink-muted">
            <span>Tax:</span>
            <span>+{formatINR(safeNumber(purchaseOrder.totalTax))}</span>
          </div> */}
          {isInterState ? (
            <div className="flex justify-between text-ink-muted">
              <span>IGST:</span>
              <span>+{formatINR(safeNumber(purchaseOrder.totalIgst))}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-ink-muted">
                <span>CGST:</span>
                <span>+{formatINR(safeNumber(purchaseOrder.totalCgst))}</span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>SGST:</span>
                <span>+{formatINR(safeNumber(purchaseOrder.totalSgst))}</span>
              </div>
            </>
          )}
          {Number((purchaseOrder as any).roundingAdjust || 0) !== 0 && (
            <div className="flex justify-between text-ink-muted">
              <span>Round Off:</span>
              <span>
                {Number((purchaseOrder as any).roundingAdjust) > 0 ? "+" : ""}
                {formatINR(safeNumber((purchaseOrder as any).roundingAdjust))}
              </span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-line pt-2 text-base font-bold text-ink">
            <span>Net Amount:</span>
            <span>{formatINR(safeNumber(purchaseOrder.netAmount))}</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <CommonViewModal
      show={show}
      onHide={onHide}
      size="lg"
      modalTitle="Purchase Order Details"
      avatarText="PO"
      headerTitle={purchaseOrder.poNumber}
      headerSubtitle={
        purchaseOrder.supplier?.displayName ||
        purchaseOrder.supplier?.legalName ||
        purchaseOrder.supplier?.supplierName ||
        "No Supplier"
      }
      statusNode={<StatusBadge status={purchaseOrder.status} />}
      sections={sections}
      customContent={customContent}
    />
  );
};

export default PurchaseOrderViewModal;
