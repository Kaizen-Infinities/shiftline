import React from "react";
import { Boxes, Lock, PackageCheck, Trash2, Warehouse } from "lucide-react";
import { Chip, PageHeader, Tile } from "../../../components/ui/v2";

const STORE_CATEGORIES = [
  {
    code: "RAW_MATERIAL",
    name: "Raw Material Store",
    description: "Stores that hold raw materials used in production",
    icon: <Boxes size={20} />,
  },
  {
    code: "FINISHED_GOODS",
    name: "Finished Goods Store",
    description: "Stores that hold completed finished products ready for dispatch",
    icon: <PackageCheck size={20} />,
  },
  {
    code: "WASTAGE",
    name: "Wastage Store",
    description: "Stores that hold production wastage, scrap, and rejected items",
    icon: <Trash2 size={20} />,
  },
];

const StoreTypeList: React.FC = () => {
  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Store Categories"
        subtitle="Store categories are fixed system-defined types. All stores must belong to one of the following categories."
        icon={<Warehouse size={22} />}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {STORE_CATEGORIES.map((cat) => (
          <Tile key={cat.code} className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-chip text-accent"
                aria-hidden="true"
              >
                {cat.icon}
              </span>
              <div className="min-w-0">
                <p className="m-0 font-semibold text-ink">{cat.name}</p>
                <Chip size="sm" tone="muted" className="mt-1 font-mono">
                  {cat.code}
                </Chip>
              </div>
            </div>
            <p className="m-0 text-sm text-ink-subtle">{cat.description}</p>
          </Tile>
        ))}
      </div>

      <Tile className="mt-4 flex items-start gap-3">
        <Lock
          size={18}
          className="mt-0.5 shrink-0 text-[color:var(--color-warning)]"
          aria-hidden="true"
        />
        <div>
          <p className="m-0 text-sm font-semibold text-ink">
            System-defined categories — cannot be added, edited, or deleted.
          </p>
          <p className="m-0 mt-1 text-sm text-ink-subtle">
            When creating a store, select the appropriate category. Each category controls which
            forms and modules that store appears in.
          </p>
        </div>
      </Tile>
    </div>
  );
};

export default StoreTypeList;
