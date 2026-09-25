import React from "react";
import { FaBoxes, FaBoxOpen, FaTrashAlt } from "react-icons/fa";

const STORE_CATEGORIES = [
  {
    code: "RAW_MATERIAL",
    name: "Raw Material Store",
    description: "Stores that hold raw materials used in production",
    icon: <FaBoxes className="text-ink-muted text-2xl" />,
  },
  {
    code: "FINISHED_GOODS",
    name: "Finished Goods Store",
    description: "Stores that hold completed finished products ready for dispatch",
    icon: <FaBoxOpen className="text-ink-muted text-2xl" />,
  },
  {
    code: "WASTAGE",
    name: "Wastage Store",
    description: "Stores that hold production wastage, scrap, and rejected items",
    icon: <FaTrashAlt className="text-ink-muted text-2xl" />,
  },
];

const StoreTypeList: React.FC = () => {
  return (
    <div className="max-w-[1024px] xl:mr-auto bg-card rounded-sm border border-line overflow-hidden">
      <div className="p-6 border-b border-line">
        <h2 className="text-2xl font-bold text-ink">Store Categories</h2>
        <p className="text-sm text-ink-subtle mt-1">
          Store categories are fixed system-defined types. All stores must belong to one of the
          following categories.
        </p>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {STORE_CATEGORIES.map((cat) => (
            <div key={cat.code} className="border border-line rounded-lg p-5 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-card-2">
                  {cat.icon}
                </div>
                <div>
                  <p className="font-semibold text-ink text-sm">{cat.name}</p>
                  <span className="inline-flex items-center text-xs font-mono px-2 py-0.5 rounded-sm border border-line bg-card-2 text-ink-muted">
                    {cat.code}
                  </span>
                </div>
              </div>
              <p className="text-xs text-ink-subtle">{cat.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 bg-[color:var(--color-warning)]/10 border border-[color:var(--color-warning)]/40 rounded-lg">
          <p className="text-sm text-[color:var(--color-warning)] font-medium">
            System-defined categories — cannot be added, edited, or deleted.
          </p>
          <p className="text-xs text-ink-subtle mt-1">
            When creating a store, select the appropriate category. Each category controls which
            forms and modules that store appears in.
          </p>
        </div>
      </div>
    </div>
  );
};

export default StoreTypeList;
