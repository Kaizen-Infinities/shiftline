import React, { useState, useMemo, useCallback } from "react";
import { Plus, RefreshCw, Network, Folder } from "lucide-react";
import { toast } from "react-toastify";
import SelectInput from "../../../../components/form/SelectInput/SelectInput";
import ExportCSVButton from "../../../../components/ui/ExportCSVButton/ExportCSVButton";
import DataTable, { type DataTableColumn } from "../../../../components/ui/table/DataTable";
import CommonModal from "../../../../components/ui/Modal/CommonModal";
import {
  ActionPill,
  Chip,
  Field,
  PageHeader,
  SearchField,
  StatTile,
  fieldControlClass,
} from "../../../../components/ui/v2";
import {
  accountService,
  type AccountLedger,
  type LedgerGroupNode,
} from "../../../../services/accountService";
import { useListCache, prependToListCacheByPrefix } from "../../../../hooks/useListCache";
import { usePermission } from "../../../../hooks/usePermission";

const TYPE_LABELS: Array<{ key: string; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "ASSET", label: "Assets" },
  { key: "LIABILITY", label: "Liabilities" },
  { key: "INCOME", label: "Income" },
  { key: "EXPENSE", label: "Expenses" },
  { key: "EQUITY", label: "Equity" },
];

export const ChartOfAccountsPage: React.FC = () => {
  const { can } = usePermission();
  // Applied filter state
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedType, setSelectedType] = useState<string>("ALL");

  // Draft filter state for Apply / Clear All
  const [draftSearchTerm, setDraftSearchTerm] = useState<string>(searchTerm);
  const [draftSelectedType, setDraftSelectedType] = useState<string>(selectedType);

  const [showModal, setShowModal] = useState<boolean>(false);

  // New Ledger Form State
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    type: "ASSET" as "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | "EQUITY",
    group: "",
    groupId: "" as string,
  });
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Chart-of-accounts tree (P1-09c): the group picker and the "Group" column read from it.
  const [groups, setGroups] = useState<LedgerGroupNode[]>([]);
  React.useEffect(() => {
    accountService
      .fetchGroups(true)
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);
  const groupOptions = useMemo(
    () =>
      groups
        .filter((g) => g.nature === formData.type)
        .map((g) => ({ value: String(g.id), label: g.path ?? g.name })),
    [groups, formData.type]
  );
  const groupPath = useMemo(() => new Map(groups.map((g) => [g.id, g.path ?? g.name])), [groups]);

  const cacheKey = `accounts:chart-of-accounts`;

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    try {
      const res = await accountService.fetchLedgers({ page: 1, limit: 10000 });
      const list = res.ledgers || [];
      return { data: list, total: list.length };
    } catch (err: any) {
      toast.error(err?.message || "Failed to load Chart of Accounts");
      throw err;
    }
  }, []);

  const {
    data: ledgers,
    loading,
    refreshing,
    refresh,
    error: listError,
  } = useListCache<AccountLedger>({
    cacheKey,
    socketModule: "accountLedger",
    fetcher,
  });

  const handleApplyFilters = () => {
    setSearchTerm(draftSearchTerm);
    setSelectedType(draftSelectedType);
  };

  const handleClearFilters = () => {
    setDraftSearchTerm("");
    setDraftSelectedType("ALL");
    setSearchTerm("");
    setSelectedType("ALL");
  };

  const filteredLedgers = useMemo(() => {
    return ledgers.filter((item) => {
      const matchesSearch =
        item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.group.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesType = selectedType === "ALL" || item.type === selectedType;
      return matchesSearch && matchesType;
    });
  }, [ledgers, searchTerm, selectedType]);

  const handleCreateLedger = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code || !formData.name || (!formData.groupId && !formData.group)) {
      toast.error("Please fill all required fields");
      return;
    }

    setSubmitting(true);
    try {
      const created = await accountService.createLedger({
        code: formData.code,
        name: formData.name,
        type: formData.type,
        groupId: formData.groupId ? Number(formData.groupId) : undefined,
        group: formData.groupId ? undefined : formData.group,
        isActive: true,
      });
      // Optimistic list update — new ledger appears instantly.
      if (created?.id) {
        prependToListCacheByPrefix<AccountLedger>("accounts:chart-of-accounts", created);
      }
      toast.success("Account ledger created successfully");
      setShowModal(false);
      setFormData({ code: "", name: "", type: "ASSET", group: "", groupId: "" });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to create ledger");
    } finally {
      setSubmitting(false);
    }
  };

  // CSV Export Configuration
  const { csvData, csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Code", accessor: (item: AccountLedger) => item.code },
      { header: "Account Name", accessor: (item: AccountLedger) => item.name },
      { header: "Account Type", accessor: (item: AccountLedger) => item.type },
      { header: "Group Category", accessor: (item: AccountLedger) => item.group },
      {
        header: "Linked Party / System",
        accessor: (item: AccountLedger) =>
          item.customer
            ? `Customer: ${item.customer.firmName} (${item.customer.customerCode})`
            : item.supplier
              ? `Supplier: ${item.supplier.legalName} (${item.supplier.supplierCode})`
              : "General System Ledger",
      },
      {
        header: "Status",
        accessor: (item: AccountLedger) => (item.isActive ? "Active" : "Inactive"),
      },
    ];

    return {
      csvData: filteredLedgers,
      csvColumns: columns,
      csvFilename: `Chart_of_Accounts_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, [filteredLedgers]);

  // Sidebar summary counts (from FULL ledger list, not filtered — user wants
  // an at-a-glance picture of the whole chart of accounts).
  const summary = useMemo(() => {
    const s = {
      total: ledgers.length,
      active: 0,
      inactive: 0,
      groups: new Set<string>(),
      byType: { ASSET: 0, LIABILITY: 0, INCOME: 0, EXPENSE: 0, EQUITY: 0 } as Record<
        string,
        number
      >,
    };
    for (const l of ledgers) {
      if (l.isActive) s.active++;
      else s.inactive++;
      if (l.group) s.groups.add(l.group);
      if (s.byType[l.type] !== undefined) s.byType[l.type]++;
    }
    return {
      total: s.total,
      active: s.active,
      inactive: s.inactive,
      groupsCount: s.groups.size,
      byType: s.byType,
    };
  }, [ledgers]);

  // Chips and search apply instantly (the draft and applied values stay in step).
  const setType = (type: string) => {
    setDraftSelectedType(type);
    setSelectedType(type);
  };
  const setSearch = (value: string) => {
    setDraftSearchTerm(value);
    setSearchTerm(value);
  };
  const filtersActive = searchTerm !== "" || selectedType !== "ALL";
  void handleApplyFilters;

  const columns: DataTableColumn<AccountLedger>[] = [
    {
      header: "Code",
      render: (item) => (
        <span className="whitespace-nowrap font-semibold tabular-nums text-accent">
          {item.code}
        </span>
      ),
    },
    {
      header: "Account name",
      render: (item) => <span className="font-medium text-ink">{item.name}</span>,
    },
    {
      header: "Type",
      render: (item) => (
        <Chip size="sm" tone="muted">
          {item.type.charAt(0) + item.type.slice(1).toLowerCase()}
        </Chip>
      ),
    },
    {
      header: "Group",
      render: (item) => (
        <span className="flex items-center gap-1.5 text-ink-muted">
          <Folder size={14} className="shrink-0 text-ink-subtle" aria-hidden="true" />
          {(item.groupId && groupPath.get(item.groupId)) || item.ledgerGroup?.name || item.group}
        </span>
      ),
    },
    {
      header: "Linked party / system",
      render: (item) =>
        item.customer ? (
          <span className="text-ink">
            <span className="text-ink-subtle">Customer · </span>
            {item.customer.firmName}{" "}
            <span className="text-ink-subtle">({item.customer.customerCode})</span>
          </span>
        ) : item.supplier ? (
          <span className="text-ink">
            <span className="text-ink-subtle">Supplier · </span>
            {item.supplier.legalName}{" "}
            <span className="text-ink-subtle">({item.supplier.supplierCode})</span>
          </span>
        ) : (
          <span className="text-ink-subtle">General System Ledger</span>
        ),
    },
    {
      header: "Status",
      render: (item) =>
        item.isActive ? (
          <Chip size="sm" tone="success" dot>
            Active
          </Chip>
        ) : (
          <Chip size="sm" tone="muted" dot>
            Inactive
          </Chip>
        ),
    },
  ];

  return (
    <div className="sl-page">
      <PageHeader
        title="Chart of accounts"
        subtitle={`${summary.total} ledgers in ${summary.groupsCount} groups · grouped per Schedule III`}
        icon={<Network size={20} />}
        primaryAction={
          <ActionPill icon={<Plus size={18} />} onClick={() => setShowModal(true)}>
            New Ledger
          </ActionPill>
        }
        actions={
          <>
            <ActionPill
              variant="secondary"
              icon={<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />}
              onClick={refresh}
              title="Refresh"
            >
              Refresh
            </ActionPill>
            {(can("chart-of-accounts.export") || can("accounts.export")) && (
              <ExportCSVButton
                data={csvData}
                columns={csvColumns}
                filename={csvFilename}
                text="Export"
              />
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Total ledgers"
          value={summary.total}
          loading={loading && !ledgers.length}
        />
        <StatTile label="Active" value={summary.active} loading={loading && !ledgers.length} />
        <StatTile label="Inactive" value={summary.inactive} loading={loading && !ledgers.length} />
        <StatTile label="Groups" value={summary.groupsCount} loading={loading && !ledgers.length} />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="group"
          aria-label="Account type"
          className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
        >
          {TYPE_LABELS.map((t) => (
            <Chip
              key={t.key}
              size="lg"
              className="shrink-0"
              selected={selectedType === t.key}
              onClick={() => setType(t.key)}
              count={t.key === "ALL" ? summary.total : summary.byType[t.key]}
            >
              {t.label}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <SearchField
            value={draftSearchTerm}
            onValueChange={setSearch}
            placeholder="Code / name / group..."
          />
          {filtersActive && (
            <ActionPill variant="secondary" size="sm" onClick={handleClearFilters}>
              Clear
            </ActionPill>
          )}
        </div>
      </div>

      <DataTable
        error={listError}
        sourceRowCount={ledgers.length}
        onRetry={refresh}
        ariaLabel="Chart of Accounts"
        columns={columns}
        data={filteredLedgers}
        rowKey={(item) => item.id}
        loading={loading && ledgers.length === 0}
        density="compact"
        maxHeightClassName="max-h-[calc(100vh-360px)]"
        emptyMessage={
          filtersActive ? "No account ledgers match these filters." : "No account ledgers yet."
        }
        emptyAction={
          filtersActive ? (
            <ActionPill variant="secondary" size="sm" onClick={handleClearFilters}>
              Clear filters
            </ActionPill>
          ) : undefined
        }
      />
      <p className="sl-muted m-0 text-right text-[12.5px] tabular-nums">
        Showing {filteredLedgers.length} of {ledgers.length}
      </p>

      <CommonModal
        show={showModal}
        onHide={() => setShowModal(false)}
        title="New account ledger"
        maxWidth="lg"
        overflowVisible
        footer={
          <>
            <ActionPill
              variant="secondary"
              onClick={() => setShowModal(false)}
              disabled={submitting}
            >
              Cancel
            </ActionPill>
            <ActionPill
              type="submit"
              form="new-ledger-form"
              loading={submitting}
              loadingText="Saving..."
            >
              Save Ledger
            </ActionPill>
          </>
        }
      >
        <form
          id="new-ledger-form"
          onSubmit={handleCreateLedger}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field label="Ledger code" required>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              placeholder="e.g. ACC-1001"
              className={fieldControlClass(false, "tabular-nums")}
              required
            />
          </Field>
          <Field label="Account name" required>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Office Stationery Expenses"
              className={fieldControlClass()}
              required
            />
          </Field>
          <div className="sm:col-span-2">
            <SelectInput
              label="Ledger type"
              noMargin
              required
              searchable={false}
              value={formData.type}
              onChange={(e) =>
                setFormData({ ...formData, type: e.target.value as any, groupId: "" })
              }
              options={[
                { value: "ASSET", label: "ASSET" },
                { value: "LIABILITY", label: "LIABILITY" },
                { value: "INCOME", label: "INCOME" },
                { value: "EXPENSE", label: "EXPENSE" },
                { value: "EQUITY", label: "EQUITY" },
              ]}
            />
          </div>
          <div className="sm:col-span-2">
            {groupOptions.length > 0 ? (
              <SelectInput
                label="Group"
                noMargin
                required
                searchable
                value={formData.groupId}
                onChange={(e) => setFormData({ ...formData, groupId: e.target.value, group: "" })}
                options={[{ value: "", label: "Select a group" }, ...groupOptions]}
              />
            ) : (
              <Field label="Group" required>
                <input
                  type="text"
                  value={formData.group}
                  onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                  placeholder="e.g. Administrative Expenses, Bank Accounts"
                  className={fieldControlClass()}
                  required
                />
              </Field>
            )}
            <p className="sl-field-hint m-0">
              Groups follow Schedule III; the balance sheet and P&amp;L roll up from them.
            </p>
          </div>
        </form>
      </CommonModal>
    </div>
  );
};

export default ChartOfAccountsPage;
