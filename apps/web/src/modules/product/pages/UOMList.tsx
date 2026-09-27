import React, { useMemo, useState } from "react";
import { Ruler } from "lucide-react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import { useUOM } from "../../../hooks/useUOM";
import { ActionPill, Chip, PageHeader, Toolbar, Tile } from "../../../components/ui/v2";

const ITEMS_PER_PAGE = 15;

const UOMList: React.FC = () => {
  const { units, loading, error } = useUOM();
  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  usePageShortcuts({});

  const categories = useMemo(
    () => Array.from(new Set(units.map((u) => u.category).filter(Boolean))) as string[],
    [units]
  );

  // Filter units by the search term and the category chip
  const filteredUnits = units.filter((u) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      (u.code || "").toLowerCase().includes(searchLower) ||
      (u.label || "").toLowerCase().includes(searchLower) ||
      (u.category || "").toLowerCase().includes(searchLower);
    return matchesSearch && (!category || u.category === category);
  });

  const totalPages = Math.ceil(filteredUnits.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedUOMs = filteredUnits.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const columns: DataTableColumn<any>[] = [
    { header: "#", render: (_, index) => startIndex + index + 1, width: "56px", align: "center" },
    {
      header: "Code",
      accessor: "code",
      render: (uom) => <span className="font-mono font-semibold text-accent">{uom.code}</span>,
    },
    { header: "Label / Name", accessor: "label" },
    {
      header: "Category",
      accessor: "category",
      render: (uom) => (
        <Chip size="sm" className="capitalize">
          {uom.category}
        </Chip>
      ),
    },
  ];

  const hasFilters = Boolean(searchTerm || category);

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="UOM Management"
        subtitle={`${units.length} units of measure · system defined, used on items and stock`}
        icon={<Ruler size={22} />}
      />

      <Toolbar
        searchValue={searchTerm}
        onSearchChange={(value) => {
          setSearchTerm(value);
          setCurrentPage(1);
        }}
        searchPlaceholder="Search by code, name, or category..."
        searchLabel="Search units"
        filters={[
          { key: "", label: "All" },
          ...categories.map((c) => ({ key: c, label: <span className="capitalize">{c}</span> })),
        ]}
        filterValue={category}
        onFilterChange={(key) => {
          setCategory(key);
          setCurrentPage(1);
        }}
        filtersLabel="Category"
      />

      {error ? (
        <Tile>
          <p role="alert" className="m-0 text-center text-[color:var(--color-danger)]">
            Could not load units of measure.
          </p>
        </Tile>
      ) : (
        <DataTable
          columns={columns}
          data={paginatedUOMs}
          rowKey={(row) => `${row.category}-${row.code}`}
          loading={loading}
          ariaLabel="Units of measure"
          emptyMessage={hasFilters ? "No units match these filters." : "No UOMs found."}
          emptyAction={
            hasFilters ? (
              <ActionPill
                variant="secondary"
                onClick={() => {
                  setSearchTerm("");
                  setCategory("");
                }}
              >
                Clear filters
              </ActionPill>
            ) : undefined
          }
          pagination={
            totalPages > 1 ? { currentPage, totalPages, onPageChange: setCurrentPage } : undefined
          }
        />
      )}
    </div>
  );
};

export default UOMList;
