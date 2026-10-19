import React from "react";
import { PageHeader } from "../../../components/ui/v2";
import StockRecordingNotice from "../../stock/lib/StockRecordingNotice";

const RECORDING_LINKS = [
  { label: "Production orders", to: "/production-orders" },
  { label: "Stock adjustments", to: "/inventory/stock-adjustments" },
];

/**
 * Finished goods stock balances are changed only by the flows that move stock, so this screen
 * does not offer an edit save (C14).
 */
const FinishedStockEdit: React.FC = () => (
  <div className="sl-page sl-page-form">
    <PageHeader
      title="Edit finished goods stock"
      back="/finished-stock"
      backLabel="Back to list"
      breadcrumbs={[
        { label: "Inventory" },
        { label: "Finished goods stock", to: "/finished-stock" },
        { label: "Edit" },
      ]}
    />
    <StockRecordingNotice links={RECORDING_LINKS} />
  </div>
);

export default FinishedStockEdit;
