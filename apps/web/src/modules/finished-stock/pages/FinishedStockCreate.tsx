import React from "react";
import { PageHeader } from "../../../components/ui/v2";
import StockRecordingNotice from "../../stock/lib/StockRecordingNotice";

const RECORDING_LINKS = [
  { label: "Production orders", to: "/production-orders" },
  { label: "Stock adjustments", to: "/inventory/stock-adjustments" },
];

/**
 * No create API records finished goods stock from this form, so it does not offer a save (C14).
 */
const FinishedStockCreate: React.FC = () => (
  <div className="sl-page sl-page-form">
    <PageHeader
      title="New finished goods stock"
      back="/finished-stock"
      backLabel="Back to list"
      breadcrumbs={[
        { label: "Inventory" },
        { label: "Finished goods stock", to: "/finished-stock" },
        { label: "New" },
      ]}
    />
    <StockRecordingNotice links={RECORDING_LINKS} />
  </div>
);

export default FinishedStockCreate;
