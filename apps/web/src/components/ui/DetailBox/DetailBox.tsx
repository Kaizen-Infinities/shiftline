import React from "react";

/** A labelled value on a detail screen: small slate label above, the value below. */
const DetailBox: React.FC<{ label: string; value: React.ReactNode; icon?: React.ReactNode }> = ({
  label,
  value,
  icon,
}) => (
  <div className="min-w-0">
    <div className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink-subtle">
      {icon && (
        <span className="inline-flex text-ink-subtle" aria-hidden="true">
          {icon}
        </span>
      )}
      {label}
    </div>
    <div className="break-words text-sm font-semibold text-ink">{value ?? "—"}</div>
  </div>
);

export default DetailBox;
