import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Check, Plus, Tags, Trash2, X } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import { customerService } from "../../../services/customerService";
import { productService } from "../../../services/productService";
import { asnService, type PartMap, type PartMapPatch } from "../../../services/asnService";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SearchField,
  SkeletonRows,
  Tile,
  cx,
} from "../../../components/ui/v2";
import { PAGE_CLASS, errorMessage } from "../shared/tradeUi";

/**
 * Customer part-number map (TN-07): the OEM's part number and standard pack for each of our
 * products, edited inline. ASNs and packing labels read it; an ASN line copies the number, so
 * editing a mapping never changes an ASN already raised.
 */
const th = "sl-th px-3 py-3 text-left";
const td = "px-2 py-2 text-sm text-ink align-middle";
const cell = "sl-input h-9 text-sm";

interface Option {
  id: string;
  label: string;
}

const blankRow = (customerId: string) => ({
  customerId,
  productId: "",
  customerPartNo: "",
  description: "",
  packQty: "",
  packType: "",
});

/** An input that saves its value on blur (or Enter) when it changed. */
const InlineInput: React.FC<{
  value: string;
  label: string;
  disabled?: boolean;
  className?: string;
  numeric?: boolean;
  maxLength?: number;
  onSave: (v: string) => Promise<boolean>;
}> = ({ value, label, disabled, className, numeric, maxLength, onSave }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async () => {
    if (draft.trim() === value) return;
    if (!(await onSave(draft.trim()))) setDraft(value);
  };
  return (
    <input
      className={cx(cell, numeric && "text-right tabular-nums", className)}
      aria-label={label}
      value={draft}
      disabled={disabled}
      maxLength={maxLength}
      inputMode={numeric ? "decimal" : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
};

const CustomerPartMapPage: React.FC = () => {
  const { can } = usePermission();
  const canEdit = can("asn.edit");
  const canCreate = can("asn.create");
  const [customers, setCustomers] = useState<Option[]>([]);
  const [products, setProducts] = useState<Option[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<PartMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<ReturnType<typeof blankRow> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(
        await asnService.partMaps({
          ...(customerId ? { customerId } : {}),
          ...(search.trim() ? { q: search.trim() } : {}),
        })
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [customerId, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    customerService
      .fetchAll({ limit: 200 })
      .then((r) =>
        setCustomers(
          r.customers.map((c) => ({
            id: String(c.id),
            label: (c as { displayName?: string }).displayName || c.firmName,
          }))
        )
      )
      .catch(() => setCustomers([]));
    productService
      .fetchAll()
      .then((list) =>
        setProducts(
          list.map((p) => ({ id: String(p.id), label: `${p.productCode} · ${p.productName}` }))
        )
      )
      .catch(() => setProducts([]));
  }, []);

  const patch = async (row: PartMap, body: PartMapPatch): Promise<boolean> => {
    try {
      const updated = await asnService.updatePartMap(row.id, body);
      setRows((rs) => rs.map((r) => (r.id === row.id ? updated : r)));
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  };

  const remove = async (row: PartMap) => {
    if (!window.confirm(`Remove ${row.customerPartNo} for ${row.customerName}?`)) return;
    try {
      await asnService.deletePartMap(row.id);
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      toast.success("Mapping removed");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adding) return;
    try {
      const created = await asnService.createPartMap({
        customerId: adding.customerId,
        productId: adding.productId,
        customerPartNo: adding.customerPartNo.trim(),
        description: adding.description.trim() || undefined,
        packQty: adding.packQty ? Number(adding.packQty) : undefined,
        packType: adding.packType.trim() || undefined,
      });
      setRows((rs) => [created, ...rs]);
      setAdding(blankRow(adding.customerId));
      toast.success(`${created.customerPartNo} mapped`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className={cx(PAGE_CLASS, "flex flex-col gap-5")}>
      <PageHeader
        title="Customer part numbers"
        icon={<Tags size={22} />}
        subtitle="Each OEM's part number and standard pack for your products; ASNs and labels use them."
        primaryAction={
          canCreate && !adding ? (
            <ActionPill icon={<Plus size={18} />} onClick={() => setAdding(blankRow(customerId))}>
              Add mapping
            </ActionPill>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="sl-input h-11 w-auto min-w-[220px] pr-9"
            aria-label="Customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <SearchField
            value={search}
            onValueChange={setSearch}
            placeholder="Part no., item or description"
          />
        </div>
      </PageHeader>

      <Tile
        padding="none"
        divider
        title="Mappings"
        subtitle="Click a cell to edit; changes save when you leave it."
      >
        <form onSubmit={add} className="overflow-x-auto">
          <table className="w-full min-w-[980px]" aria-label="Customer part numbers">
            <thead className="bg-card-2">
              <tr>
                <th scope="col" className={th}>
                  Customer
                </th>
                <th scope="col" className={th}>
                  Customer part no.
                </th>
                <th scope="col" className={th}>
                  Our item
                </th>
                <th scope="col" className={th}>
                  Description on ASN
                </th>
                <th scope="col" className={`${th} !text-right`}>
                  Std pack
                </th>
                <th scope="col" className={th}>
                  Pack type
                </th>
                <th scope="col" className={th}>
                  Active
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {adding && (
                <tr className="border-t border-line-soft bg-nav-active">
                  <td className={td}>
                    <select
                      className={cx(cell, "w-44 pr-8")}
                      aria-label="New mapping customer"
                      value={adding.customerId}
                      required
                      onChange={(e) => setAdding({ ...adding, customerId: e.target.value })}
                    >
                      <option value="">Customer</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={td}>
                    <input
                      className={cx(cell, "w-36 font-mono")}
                      aria-label="New customer part number"
                      placeholder="OEM part no."
                      maxLength={40}
                      required
                      value={adding.customerPartNo}
                      onChange={(e) => setAdding({ ...adding, customerPartNo: e.target.value })}
                    />
                  </td>
                  <td className={td}>
                    <select
                      className={cx(cell, "w-56 pr-8")}
                      aria-label="New mapping item"
                      value={adding.productId}
                      required
                      onChange={(e) => setAdding({ ...adding, productId: e.target.value })}
                    >
                      <option value="">Item</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={td}>
                    <input
                      className={cx(cell, "w-48")}
                      aria-label="New description"
                      maxLength={120}
                      value={adding.description}
                      onChange={(e) => setAdding({ ...adding, description: e.target.value })}
                    />
                  </td>
                  <td className={td}>
                    <input
                      className={cx(cell, "w-24 text-right tabular-nums")}
                      aria-label="New standard pack"
                      inputMode="decimal"
                      value={adding.packQty}
                      onChange={(e) => setAdding({ ...adding, packQty: e.target.value })}
                    />
                  </td>
                  <td className={td}>
                    <input
                      className={cx(cell, "w-24")}
                      aria-label="New pack type"
                      placeholder="BIN"
                      maxLength={30}
                      value={adding.packType}
                      onChange={(e) => setAdding({ ...adding, packType: e.target.value })}
                    />
                  </td>
                  <td className={td} />
                  <td className={td}>
                    <span className="flex justify-end gap-1.5">
                      <ActionPill type="submit" size="sm" icon={<Check size={14} />}>
                        Save
                      </ActionPill>
                      <button
                        type="button"
                        className="sl-icon-btn sl-icon-btn-ghost"
                        aria-label="Discard new mapping"
                        onClick={() => setAdding(null)}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </span>
                  </td>
                </tr>
              )}
              {loading ? (
                <tr>
                  <td colSpan={8}>
                    <SkeletonRows rows={4} columns={5} header={false} />
                  </td>
                </tr>
              ) : rows.length === 0 && !adding ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      compact
                      icon={<Tags size={22} />}
                      title="No part numbers mapped yet."
                      description={
                        canCreate
                          ? "Add each OEM part number once; every ASN for that customer picks it up."
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-line-soft">
                    <td className={cx(td, "max-w-[180px] truncate px-3 font-medium")}>
                      {r.customerName}
                    </td>
                    <td className={td}>
                      <InlineInput
                        value={r.customerPartNo}
                        label={`Customer part number ${r.customerPartNo}`}
                        className="w-36 font-mono"
                        maxLength={40}
                        disabled={!canEdit}
                        onSave={(v) =>
                          v ? patch(r, { customerPartNo: v }) : Promise.resolve(false)
                        }
                      />
                    </td>
                    <td className={td}>
                      <select
                        className={cx(cell, "w-56 pr-8")}
                        aria-label={`Item for ${r.customerPartNo}`}
                        value={r.productId}
                        disabled={!canEdit}
                        onChange={(e) => void patch(r, { productId: e.target.value })}
                      >
                        {!products.some((p) => p.id === r.productId) && (
                          <option value={r.productId}>
                            {r.productCode} · {r.productName}
                          </option>
                        )}
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={td}>
                      <InlineInput
                        value={r.description ?? ""}
                        label={`Description for ${r.customerPartNo}`}
                        className="w-48"
                        maxLength={120}
                        disabled={!canEdit}
                        onSave={(v) => patch(r, { description: v || null })}
                      />
                    </td>
                    <td className={td}>
                      <InlineInput
                        value={r.packQty === null ? "" : String(r.packQty)}
                        label={`Standard pack for ${r.customerPartNo}`}
                        className="w-24"
                        numeric
                        disabled={!canEdit}
                        onSave={(v) => patch(r, { packQty: numOrNull(v) })}
                      />
                    </td>
                    <td className={td}>
                      <InlineInput
                        value={r.packType ?? ""}
                        label={`Pack type for ${r.customerPartNo}`}
                        className="w-24"
                        maxLength={30}
                        disabled={!canEdit}
                        onSave={(v) => patch(r, { packType: v || null })}
                      />
                    </td>
                    <td className={td}>
                      <button
                        type="button"
                        disabled={!canEdit}
                        aria-pressed={r.isActive}
                        aria-label={`${r.customerPartNo} active`}
                        onClick={() => void patch(r, { isActive: !r.isActive })}
                        className="disabled:cursor-default"
                      >
                        <Chip size="sm" dot tone={r.isActive ? "success" : "muted"}>
                          {r.isActive ? "Active" : "Off"}
                        </Chip>
                      </button>
                    </td>
                    <td className={cx(td, "text-right")}>
                      {canEdit && (
                        <button
                          type="button"
                          className="sl-icon-btn sl-icon-btn-ghost"
                          aria-label={`Remove ${r.customerPartNo}`}
                          onClick={() => void remove(r)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </form>
      </Tile>
    </div>
  );
};

export default CustomerPartMapPage;
