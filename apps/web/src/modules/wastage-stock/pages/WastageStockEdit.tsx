import React from "react";
import { PageHeader } from "../../../components/ui/v2";
import StockRecordingNotice from "../../stock/lib/StockRecordingNotice";

const RECORDING_LINKS = [
  { label: "Goods received (GRN)", to: "/invoice" },
  { label: "Production wastage", to: "/production-wastages" },
  { label: "Stock adjustments", to: "/inventory/stock-adjustments" },
];

/**
 * Wastage stock balances are changed only by the flows that move stock, so this screen
 * does not offer an edit save (C14).
 */
const WastageStockEdit: React.FC = () => (
  <div className="sl-page sl-page-form">
    <PageHeader
      title="Edit wastage stock"
      back="/wastage-stock"
      backLabel="Back to list"
      breadcrumbs={[
        { label: "Inventory" },
        { label: "Wastage stock", to: "/wastage-stock" },
        { label: "Edit" },
      ]}
    />
    <StockRecordingNotice links={RECORDING_LINKS} />
  </div>
);

export default WastageStockEdit;
