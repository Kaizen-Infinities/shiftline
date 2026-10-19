import React from "react";
import { PageHeader } from "../../../components/ui/v2";
import StockRecordingNotice from "../../stock/lib/StockRecordingNotice";

const RECORDING_LINKS = [
  { label: "Goods received (GRN)", to: "/invoice" },
  { label: "Production wastage", to: "/production-wastages" },
  { label: "Stock adjustments", to: "/inventory/stock-adjustments" },
];

/**
 * No create API records wastage stock from this form, so it does not offer a save (C14).
 */
const WastageStockCreate: React.FC = () => (
  <div className="sl-page sl-page-form">
    <PageHeader
      title="New wastage stock"
      back="/wastage-stock"
      backLabel="Back to list"
      breadcrumbs={[
        { label: "Inventory" },
        { label: "Wastage stock", to: "/wastage-stock" },
        { label: "New" },
      ]}
    />
    <StockRecordingNotice links={RECORDING_LINKS} />
  </div>
);

export default WastageStockCreate;
