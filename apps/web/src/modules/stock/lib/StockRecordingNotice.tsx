import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Info } from "lucide-react";
import { EmptyState, Tile, actionPillClass } from "../../../components/ui/v2";

export interface StockRecordingLink {
  label: string;
  to: string;
}

/**
 * Stands in for the create and edit forms of stock-balance screens. Stock is changed only by
 * the documents and flows that move it (GRN, production, adjustments), so this screen points
 * the user to them instead of offering a save that would not change stock.
 */
const StockRecordingNotice: React.FC<{ links: StockRecordingLink[] }> = ({ links }) => (
  <Tile title="Stock is recorded elsewhere">
    <EmptyState
      icon={<Info size={24} strokeWidth={1.75} />}
      title="Stock changes are recorded through GRN / production / adjustments"
      description="Use one of these screens to change the stock balance. Each change is kept as a transaction."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          {links.map((link) => (
            <Link key={link.to} to={link.to} className={actionPillClass({ variant: "secondary" })}>
              {link.label}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ))}
        </div>
      }
    />
  </Tile>
);

export default StockRecordingNotice;
