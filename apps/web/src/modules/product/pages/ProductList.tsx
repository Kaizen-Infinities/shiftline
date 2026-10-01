import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { FaCog } from "react-icons/fa";
import { Package, Plus } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";

import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import IconButton from "../../../components/ui/IconButton/IconButton";
import CommonViewModal from "../../../components/ui/CommonViewModal/CommonViewModal";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import MultiSelect from "../../../components/form/multiSelect/MultiSelect";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import TextInput from "../../../components/form/TextInput/TextInput";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { productService } from "../../../services/productService";
import { useListCache } from "../../../hooks/useListCache";
import { productCapacityHistoryService } from "../../../services/productCapacityHistoryService";
import { employeeService } from "../../../services/employeeService";
import { departmentService } from "../../../services/departmentService";
import { roleService } from "../../../services/roleService";
import { shiftService } from "../../../services/shiftService";
import { machineService } from "../../../services/machineService";
import { useSocketSync } from "../../../hooks/useSocketSync";
import { usePermission } from "../../../hooks/usePermission";
import { getImageUrl } from "../../../utils/ImageUrls";
import { categoryService } from "../../../services/categoryService";
import CommonModal from "../../../components/ui/Modal/CommonModal";
import { ActionPill, Chip, PageHeader, StatTile, Toolbar } from "../../../components/ui/v2";
import { inr, qty } from "../../stock/lib/format";

const ITEMS_PER_PAGE = 15;

const ProductList: React.FC = () => {
  const navigate = useNavigate();
  const productFetcher = useCallback(async (_signal: AbortSignal) => {
    const list = await productService.fetchAll();
    return { data: Array.isArray(list) ? list : [], total: Array.isArray(list) ? list.length : 0 };
  }, []);

  const {
    data: products,
    loading,
    refresh,
    error: listError,
  } = useListCache<any>({
    cacheKey: "products:list",
    socketModule: "product",
    fetcher: productFetcher,
  });
  const { can } = usePermission();

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [capacityRecords, setCapacityRecords] = useState<any[]>([]);
  const [loadingCapacity, setLoadingCapacity] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const initialSearch = searchParams.get("search") || "";

  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<{ label: string; value: string }[]>([]);

  // Custom confirm delete state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });
  const [isDeleting, setIsDeleting] = useState(false);

  // Capacity change modal
  const [showCapModal, setShowCapModal] = useState(false);
  const [capProduct, setCapProduct] = useState<any>(null);
  const [capDate, setCapDate] = useState(new Date().toISOString().split("T")[0]);
  const [capShift, setCapShift] = useState("");
  const [capRoleId, setCapRoleId] = useState("");
  const [capOps, setCapOps] = useState<string[]>([]);
  const [capMachine, setCapMachine] = useState("");
  const [capQty, setCapQty] = useState("");
  const [savingCap, setSavingCap] = useState(false);
  const [capErrors, setCapErrors] = useState<Record<string, string>>({});
  const [capHistoryRecords, setCapHistoryRecords] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [, setDepartments] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);

  useEffect(() => {
    if (can("products.view")) {
      employeeService
        .fetchAll({ limit: 500 })
        .then((res: any) => {
          const data = Array.isArray(res)
            ? res
            : Array.isArray(res?.data)
              ? res.data
              : Array.isArray(res?.employees)
                ? res.employees
                : [];
          setEmployees(data);
        })
        .catch(() => {});
      roleService
        .fetchAll({ limit: 100 })
        .then((res: any) => {
          const roleList = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
          setRoles(roleList);
        })
        .catch(() => {});
      departmentService
        .fetchAll()
        .then((res: any) => {
          const depts = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
          setDepartments(depts);
        })
        .catch(() => {});
      shiftService
        .fetchAll()
        .then((res: any) => {
          const data = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
          setShifts(data);
        })
        .catch(() => {});
      machineService
        .getAll({ limit: 1000 })
        .then((res: any) => {
          // Backend returns { machines: [...], total, page, totalPages }
          const data = Array.isArray(res)
            ? res
            : Array.isArray(res?.machines)
              ? res.machines
              : Array.isArray(res?.data)
                ? res.data
                : [];
          setMachines(data);
        })
        .catch(() => {});
    }
  }, [can]);

  useEffect(() => {
    categoryService
      .fetchAll({ type: "PRODUCT", isActive: true })
      .then((res: any) => {
        const list = res?.categories ?? res ?? [];
        setCategoryOptions(
          Array.isArray(list) ? list.map((c: any) => ({ label: c.name, value: String(c.id) })) : []
        );
      })
      .catch(() => {});
  }, []);

  const filteredProducts = useMemo(() => {
    return products.filter((p: any) => {
      const matchesSearch =
        !searchTerm ||
        p.productName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.productCode?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = !categoryFilter || String(p.categoryId) === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, categoryFilter]);

  useSocketSync("productCapacityHistory", undefined, () => {
    if (showViewModal && selectedProduct) {
      productCapacityHistoryService
        .fetchByProduct(Number(selectedProduct.id))
        .then((records) => setCapacityRecords(records))
        .catch(() => setCapacityRecords([]));
    }
    if (showCapModal && capProduct) {
      productCapacityHistoryService
        .fetchByProduct(Number(capProduct.id))
        .then((records) => setCapHistoryRecords(records))
        .catch(() => setCapHistoryRecords([]));
    }
  });

  const handleView = useCallback(async (product: any) => {
    setSelectedProduct(product);
    setShowViewModal(true);
    setLoadingCapacity(true);
    try {
      const records = await productCapacityHistoryService.fetchByProduct(Number(product.id));
      setCapacityRecords(records);
    } catch {
      setCapacityRecords([]);
    } finally {
      setLoadingCapacity(false);
    }
  }, []);

  const handleEdit = useCallback(
    (product: any) => {
      navigate(`/products/edit/${product.id}`, {
        state: product,
      });
    },
    [navigate]
  );

  const openCapModal = useCallback((product: any) => {
    setCapProduct(product);
    setCapDate(new Date().toISOString().split("T")[0]);
    setCapShift("");
    setCapRoleId("");
    setCapOps([]);
    setCapMachine("");
    setCapQty("");
    setCapErrors({});
    setCapHistoryRecords([]);
    setShowCapModal(true);
    // Fetch this product's capacity history so we can validate per-machine
    productCapacityHistoryService
      .fetchByProduct(Number(product.id))
      .then((records: any[]) => setCapHistoryRecords(records))
      .catch(() => setCapHistoryRecords([]));
  }, []);

  // Derive current capacity for the selected machine (highest recorded newCapacity)
  const getMachineCurrentCap = (machineId: string): number => {
    if (!machineId) return Number(capProduct?.capacityLitres ?? 0);
    const machineRecords = capHistoryRecords.filter(
      (r: any) => r.machineId === machineId && r.machineId !== "INITIAL"
    );
    if (machineRecords.length === 0) return 0;
    return Math.max(...machineRecords.map((r: any) => Number(r.newCapacity)));
  };

  const handleCapSave = async () => {
    const errs: Record<string, string> = {};
    if (!capDate) errs.capDate = "Date is required";
    if (!capShift) errs.capShift = "Shift is required";
    if (!capRoleId) errs.capRoleId = "Role is required";
    if (!capOps.length) errs.capOps = "Select at least one operator";
    if (!capQty || Number(capQty) <= 0) {
      errs.capQty = "Valid quantity required";
    } else {
      const currentCap = getMachineCurrentCap(capMachine);
      if (Number(capQty) <= currentCap) {
        const machineLabel = capMachine
          ? machines.find((m: any) => m.machineId === capMachine)?.machineName || capMachine
          : "current";
        errs.capQty = `New capacity must be greater than ${machineLabel}'s current capacity (${currentCap.toLocaleString()})`;
      }
    }
    setCapErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSavingCap(true);
    try {
      await productCapacityHistoryService.manualChange({
        productId: Number(capProduct.id),
        date: capDate,
        shift: capShift,
        machine: capMachine,
        operators: capOps
          .map((id) => employees.find((e) => String(e.id) === id)?.fullName || id)
          .join(", "),
        newCapacity: Number(capQty),
      });
      toast.success("Capacity updated successfully!");
      setShowCapModal(false);
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to update capacity");
    } finally {
      setSavingCap(false);
    }
  };

  const triggerDelete = useCallback((id: string) => {
    setProductToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (productToDelete !== null && !isDeleting) {
      setIsDeleting(true);
      try {
        await productService.delete(productToDelete);
        toast.success("Product deleted successfully!");
        refresh();
      } catch (err: any) {
        const errorMessage =
          typeof err === "string"
            ? err
            : err?.response?.data?.message || err?.message || "Failed to delete product";
        toast.error(errorMessage);
      } finally {
        setIsDeleting(false);
        setShowDeleteModal(false);
        setProductToDelete(null);
      }
    }
  };

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const fetchProductsForExport = useCallback(async () => {
    const res = await productService.fetchAll();
    return Array.isArray(res) ? res : [];
  }, []);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Product Code", accessor: (item: any) => item.productCode },
      { header: "Product Name", accessor: (item: any) => item.productName },
      { header: "Category", accessor: (item: any) => item.category?.name || "—" },
      {
        header: "Weight / Piece",
        accessor: (item: any) =>
          item.weightPerPiece != null ? `${item.weightPerPiece} ${item.weightUom || "g"}` : "—",
      },
      { header: "Rate (₹)", accessor: (item: any) => (item.rate != null ? item.rate : "—") },
      { header: "Status", accessor: (item: any) => (item.isActive ? "ACTIVE" : "INACTIVE") },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Production_Product_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const onHandOf = (product: any) =>
    (product.finishedGoodsStocks || []).reduce(
      (sum: number, s: any) => sum + (Number(s.onHandQty) || 0),
      0
    );

  const stats = useMemo(() => {
    const active = products.filter((p: any) => p.isActive).length;
    const low = products.filter((p: any) => {
      const min = Number(p.minimumQty) || 0;
      return min > 0 && onHandOf(p) < min;
    }).length;
    return { total: products.length, active, inactive: products.length - active, low };
  }, [products]);

  const hasFilters = Boolean(searchTerm || categoryFilter);

  const columns: DataTableColumn<any>[] = [
    { header: "#", render: (_, index) => startIndex + index + 1, width: "56px", align: "center" },
    {
      header: "Product",
      render: (product) => (
        <div className="flex min-w-0 flex-col">
          <button
            type="button"
            onClick={() => handleView(product)}
            className="w-fit whitespace-nowrap text-left font-semibold text-accent hover:underline underline-offset-4"
          >
            {product.productName}
          </button>
          <span className="text-xs text-ink-subtle font-mono">{product.productCode}</span>
        </div>
      ),
    },
    { header: "Category", render: (product) => product.category?.name || "—" },
    {
      header: "Product Type",
      render: (product) => (
        <Chip size="sm" tone={product.productType === "SALES_PRODUCTION" ? "info" : "default"}>
          {product.productType === "SALES_PRODUCTION" ? "Sales Production" : "Production"}
        </Chip>
      ),
    },
    {
      header: "Rate (₹)",
      render: (product) => (
        <span className="font-semibold tabular-nums text-ink">{inr(product.rate)}</span>
      ),
      align: "right",
    },
    {
      header: "Stock (Min)",
      render: (product) => {
        const onHandQty = onHandOf(product);
        const minQty = Number(product.minimumQty) || 0;
        const low = minQty > 0 && onHandQty < minQty;
        return (
          <div className="flex flex-col items-end">
            <span
              className={`font-semibold tabular-nums ${low ? "text-[color:var(--color-danger)]" : "text-ink"}`}
            >
              {qty(onHandQty)}
            </span>
            <span className="text-xs text-ink-subtle tabular-nums">Min {qty(minQty)}</span>
          </div>
        );
      },
      align: "right",
    },
    {
      header: "Status",
      render: (product) => <StatusBadge status={product.isActive ? "ACTIVE" : "INACTIVE"} />,
      align: "center",
    },
    {
      header: "Actions",
      render: (product) => (
        <div className="table-action-group w-full justify-end">
          <ViewButton onClick={() => handleView(product)} />
          {can("products.edit") && <EditButton onClick={() => handleEdit(product)} />}
          {can("products.edit") && (
            <IconButton
              icon={FaCog}
              variant="primary"
              title="Capacity Settings"
              onClick={() => openCapModal(product)}
            />
          )}
          {can("products.delete") && <DeleteButton onClick={() => triggerDelete(product.id)} />}
        </div>
      ),
      align: "right",
    },
  ];

  const createCta = can("products.create") ? (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/products/create")}>
      New Product
    </ActionPill>
  ) : null;

  return (
    <div>
      <div>
        <div className="w-full min-w-0">
          <PageHeader
            title="Production products"
            subtitle={`${stats.total} products · finished goods, their bill of materials and machine capacity`}
            icon={<Package size={22} />}
            actions={
              can("products.export") ? (
                <ExportCSVButton
                  fetchData={fetchProductsForExport}
                  columns={csvColumns}
                  filename={csvFilename}
                  text="Export"
                />
              ) : null
            }
            primaryAction={createCta}
          />

          <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile label="Products" value={qty(stats.total)} loading={loading} />
            <StatTile label="Active" value={qty(stats.active)} loading={loading} />
            <StatTile label="Inactive" value={qty(stats.inactive)} loading={loading} />
            <StatTile
              label="Below minimum stock"
              value={qty(stats.low)}
              loading={loading}
              delta={stats.low > 0 ? "Reorder" : undefined}
              deltaTone="warning"
            />
          </div>

          <Toolbar
            searchValue={searchTerm}
            onSearchChange={(value) => {
              setSearchTerm(value);
              setCurrentPage(1);
            }}
            searchPlaceholder="Search name or code"
            searchLabel="Search products"
            filters={[
              { key: "", label: "All" },
              ...categoryOptions.map((c) => ({ key: c.value, label: c.label })),
            ]}
            filterValue={categoryFilter}
            onFilterChange={(key) => {
              setCategoryFilter(key);
              setCurrentPage(1);
            }}
            filtersLabel="Category"
          />

          <DataTable
            error={listError}
            sourceRowCount={products.length}
            onRetry={refresh}
            columns={columns}
            data={paginatedProducts}
            rowKey={(row) => row.id}
            loading={loading}
            ariaLabel="Production products"
            emptyMessage={hasFilters ? "No products match these filters." : "No products yet."}
            emptyAction={
              hasFilters ? (
                <ActionPill
                  variant="secondary"
                  onClick={() => {
                    setSearchTerm("");
                    setCategoryFilter("");
                  }}
                >
                  Clear filters
                </ActionPill>
              ) : (
                createCta
              )
            }
            pagination={
              totalPages > 1
                ? {
                    currentPage: safeCurrentPage,
                    totalPages,
                    onPageChange: setCurrentPage,
                  }
                : undefined
            }
          />
        </div>

        <CommonViewModal
          show={showViewModal}
          onHide={() => setShowViewModal(false)}
          modalTitle="Product Details"
          avatarText={selectedProduct ? selectedProduct.productName.charAt(0).toUpperCase() : ""}
          headerTitle={selectedProduct ? selectedProduct.productName : ""}
          headerSubtitle={selectedProduct ? `Code: ${selectedProduct.productCode}` : ""}
          sections={
            selectedProduct
              ? [
                  {
                    fields: [
                      { label: "Product Name", value: selectedProduct.productName },
                      { label: "Product Code", value: selectedProduct.productCode },
                      {
                        label: "Product Type",
                        value:
                          selectedProduct.productType === "SALES_PRODUCTION"
                            ? "Sales Production"
                            : "Production",
                      },
                      {
                        label: "Weight per Piece",
                        value: (() => {
                          const weightUom = selectedProduct.weightUom || "g";
                          const weight =
                            selectedProduct.weightPerPiece != null
                              ? selectedProduct.weightPerPiece
                              : "";
                          return weight !== "" ? `${weight} ${weightUom}` : "N/A";
                        })(),
                      },
                      {
                        label: "Rate (₹)",
                        value: selectedProduct.rate != null ? `₹${selectedProduct.rate}` : "N/A",
                      },
                      ...(selectedProduct.gradeRates &&
                      typeof selectedProduct.gradeRates === "object" &&
                      Object.keys(selectedProduct.gradeRates).length > 0
                        ? Object.entries(selectedProduct.gradeRates as Record<string, number>).map(
                            ([grade, rate]) => ({
                              label: `Grade ${grade} Rate (₹)`,
                              value: `₹${rate}`,
                            })
                          )
                        : []),
                      {
                        label: "Opening Stock Qty",
                        value: (() => {
                          const lastStock =
                            selectedProduct.finishedGoodsStocks?.[
                              selectedProduct.finishedGoodsStocks.length - 1
                            ];
                          return lastStock?.onHandQty != null
                            ? `${lastStock.onHandQty} PCS`
                            : "N/A";
                        })(),
                      },
                      {
                        label: "Opening Stock Store",
                        value: (() => {
                          const lastStock =
                            selectedProduct.finishedGoodsStocks?.[
                              selectedProduct.finishedGoodsStocks.length - 1
                            ];
                          return lastStock?.store?.storeName || "N/A";
                        })(),
                      },
                      {
                        label: "Minimum Stock Qty",
                        value:
                          selectedProduct.minimumQty != null
                            ? `${selectedProduct.minimumQty} PCS`
                            : "N/A",
                      },
                      { label: "Status", value: selectedProduct.isActive ? "Active" : "Inactive" },
                      { label: "Description", value: selectedProduct.description || "N/A", xs: 12 },
                    ],
                  },
                ]
              : []
          }
          customContent={
            <div className="mt-6 flex flex-col gap-6">
              {/* Premium Product Images Gallery */}
              {((selectedProduct?.images && selectedProduct.images.length > 0) ||
                selectedProduct?.imageUrl) && (
                <div className="bg-card-2/70 p-4 rounded-lg border border-line/80">
                  <div className="flex items-center justify-between mb-3">
                    <h6 className="text-xs font-bold text-ink-muted tracking-wider uppercase flex items-center gap-2">
                      <span>Product Images</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-sm border border-line bg-card-2 text-ink-muted text-[11px] font-semibold">
                        {selectedProduct.images?.length || 1} Image
                        {(selectedProduct.images?.length || 1) > 1 ? "s" : ""}
                      </span>
                    </h6>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {(selectedProduct.images && selectedProduct.images.length > 0
                      ? selectedProduct.images
                      : [{ imageUrl: selectedProduct.imageUrl }]
                    ).map((img: any, idx: number) => (
                      <div
                        key={idx}
                        className="relative group aspect-square rounded-lg border border-line bg-card overflow-hidden transition-all duration-200"
                      >
                        <img
                          src={getImageUrl(img.imageUrl)}
                          alt={`Product Image ${idx + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        {img.isPrimary && (
                          <div className="absolute top-2 left-2 sl-chip sl-chip-sm">PRIMARY</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedProduct?.billOfMaterials && selectedProduct.billOfMaterials.length > 0 && (
                <>
                  {/* BOM Section */}
                  {selectedProduct.billOfMaterials.some((rm: any) => Number(rm.percentage) > 0) && (
                    <div>
                      <h6 className="text-sm font-semibold text-ink mb-2">
                        Raw Materials Composition (BOM)
                      </h6>
                      <div className="border border-line rounded-lg overflow-hidden">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                          <thead className="bg-card-2 text-ink-muted">
                            <tr>
                              <th className="px-4 py-2 font-semibold border-b border-line">
                                Raw Material
                              </th>
                              <th className="px-4 py-2 font-semibold border-b border-line text-right">
                                Percentage (%)
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line bg-card">
                            {selectedProduct.billOfMaterials
                              .filter((rm: any) => Number(rm.percentage) > 0)
                              .map((rm: any, idx: number) => (
                                <tr key={idx} className="hover:bg-card-2/50 transition-colors">
                                  <td className="px-4 py-2">
                                    {rm.rawMaterial?.materialName || rm.rawMaterialId}
                                  </td>
                                  <td className="px-4 py-2 text-right">{rm.percentage} %</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Capacity History Section */}
              <div>
                <h6 className="text-sm font-semibold text-ink mb-2 flex items-center justify-between">
                  <span>Capacity History</span>
                  {selectedProduct?.capacityLitres != null && (
                    <span className="text-xs font-normal text-ink-subtle ms-2">
                      (Current: {Number(selectedProduct.capacityLitres).toLocaleString()} / Shift)
                    </span>
                  )}
                </h6>
                {loadingCapacity ? (
                  <div className="text-center py-4 text-sm text-ink-subtle">Loading...</div>
                ) : capacityRecords.length > 0 ? (
                  <div className="border border-line rounded-lg overflow-x-auto max-w-full">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-card-2 text-ink-muted">
                        <tr>
                          <th className="px-4 py-2.5 font-semibold border-b border-line">Type</th>
                          <th className="px-4 py-2.5 font-semibold border-b border-line">Date</th>
                          <th className="px-4 py-2.5 font-semibold border-b border-line">Shift</th>
                          <th className="px-4 py-2.5 font-semibold border-b border-line">
                            Machine
                          </th>
                          <th className="px-4 py-2.5 font-semibold border-b border-line">
                            Operators
                          </th>
                          <th className="px-4 py-2.5 font-semibold border-b border-line text-right">
                            Capacity
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line bg-card">
                        {(() => {
                          // Group by machineId, preserving order-of-first-appearance
                          const groups: Record<string, any[]> = {};
                          const machineOrder: string[] = [];
                          capacityRecords.forEach((r: any) => {
                            const key = r.machineId || "INITIAL";
                            if (!groups[key]) {
                              groups[key] = [];
                              machineOrder.push(key);
                            }
                            if (groups[key].length < 2) {
                              groups[key].push(r);
                            }
                          });
                          return machineOrder.map((machineId) => {
                            const isInitial = machineId === "INITIAL";
                            const machineObj = machines.find((m: any) => m.machineId === machineId);
                            const machineName = isInitial
                              ? "Initial Setup"
                              : machineObj?.machineName || machineId;
                            return (
                              <React.Fragment key={machineId}>
                                {/* Machine group header */}
                                <tr className="bg-card-2/80">
                                  <td
                                    colSpan={6}
                                    className="px-4 py-2 text-xs font-bold text-ink-muted uppercase tracking-wider border-b border-line/60"
                                  >
                                    {isInitial ? "Initial Setup" : machineId}
                                    {!isInitial && machineName !== machineId && (
                                      <span className="font-normal normal-case text-ink-subtle ms-1.5">
                                        — {machineName}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                                {groups[machineId].map((r: any, idx: number) => {
                                  const isCurrent = idx === 0;
                                  return (
                                    <tr
                                      key={r.id || `${machineId}-${idx}`}
                                      className={`hover:bg-card-2/50 transition-colors ${isCurrent ? "bg-nav-active" : ""}`}
                                    >
                                      <td className="px-4 py-2.5">
                                        <span
                                          className={`inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider ${isInitial ? "text-[color:var(--color-success)]" : isCurrent ? "text-accent" : "text-ink-subtle"}`}
                                        >
                                          {isInitial
                                            ? "Initial"
                                            : isCurrent
                                              ? "Current"
                                              : "Previous"}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 text-ink">
                                        {new Date(r.productionDate).toLocaleDateString()}
                                      </td>
                                      <td className="px-4 py-2.5 text-ink">
                                        {r.shiftId && r.shiftId !== "INITIAL" ? r.shiftId : "-"}
                                      </td>
                                      <td className="px-4 py-2.5 text-ink">
                                        {isInitial ? "-" : machineObj?.machineName || machineId}
                                      </td>
                                      <td className="px-4 py-2.5 text-ink">{r.operators || "-"}</td>
                                      <td className="px-4 py-2.5 text-right font-semibold text-ink">
                                        {Number(r.newCapacity).toLocaleString()}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-4 text-sm text-ink-subtle bg-card-2/40 rounded-lg border border-line/50">
                    No capacity history available.
                  </div>
                )}
              </div>
            </div>
          }
        />

        {/* Custom Delete Confirm Modal */}
        <CommonConfirmModal
          show={showDeleteModal}
          onHide={() => setShowDeleteModal(false)}
          onConfirm={handleDeleteConfirm}
          title="Confirm Delete"
          message="Are you sure you want to delete this product?"
          confirmText={isDeleting ? "Deleting..." : "Delete"}
          confirmVariant="danger"
          isDangerous={true}
        />

        {/* Manual Capacity Change Modal */}
        {showCapModal && capProduct && (
          <CommonModal
            show
            onHide={() => setShowCapModal(false)}
            title="Change Capacity"
            maxWidth="2xl"
            overflowVisible
            footer={
              <>
                <ActionPill variant="secondary" onClick={() => setShowCapModal(false)}>
                  Cancel
                </ActionPill>
                <ActionPill onClick={handleCapSave} loading={savingCap} loadingText="Saving…">
                  Save capacity
                </ActionPill>
              </>
            }
          >
            <div className="space-y-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Chip>{capProduct.productName}</Chip>
                {capMachine ? (
                  <span className="text-xs text-ink-subtle">
                    (Machine Current: {getMachineCurrentCap(capMachine).toLocaleString()} / Shift)
                  </span>
                ) : (
                  <span className="text-xs text-ink-subtle">
                    (Product Current:{" "}
                    {capProduct.capacityLitres != null
                      ? Number(capProduct.capacityLitres).toLocaleString()
                      : 0}{" "}
                    / Shift)
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                <div>
                  <DatePickerCalendar
                    label="Date"
                    name="capDate"
                    value={capDate}
                    onChange={(e) => {
                      setCapDate(e.target.value);
                      setCapErrors((prev) => ({ ...prev, capDate: "" }));
                    }}
                    error={capErrors.capDate}
                  />
                </div>
                <div>
                  <SelectInput
                    label="Shift"
                    name="capShift"
                    value={capShift}
                    options={[
                      { value: "", label: "-- Shift --" },
                      ...shifts.map((s) => ({
                        value: s.shiftName || s.shiftCode,
                        label: s.shiftName || s.shiftCode,
                      })),
                    ]}
                    onChange={(e) => {
                      setCapShift(e.target.value);
                      setCapErrors((prev) => ({ ...prev, capShift: "" }));
                    }}
                    error={capErrors.capShift}
                    required
                  />
                </div>
                <div>
                  <SelectInput
                    label="Machine"
                    name="capMachine"
                    value={capMachine}
                    options={[
                      { value: "", label: "-- Machine --" },
                      ...machines.map((m) => ({
                        value: m.machineId,
                        label: `${m.machineId} - ${m.machineName}`,
                      })),
                    ]}
                    onChange={(e) => {
                      setCapMachine(e.target.value);
                      setCapQty("");
                      setCapErrors((prev) => ({ ...prev, capMachine: "", capQty: "" }));
                    }}
                    required
                  />
                </div>
                <div>
                  <SelectInput
                    label="Role"
                    name="capRoleId"
                    value={capRoleId}
                    options={[
                      { value: "", label: "-- Role --" },
                      ...roles.map((r) => ({
                        value: String(r.id || r.roleId || r.code),
                        label: r.name || r.roleName || r.code || r.roleId,
                      })),
                    ]}
                    onChange={(e) => {
                      setCapRoleId(e.target.value);
                      setCapOps([]);
                      setCapErrors((prev) => ({ ...prev, capRoleId: "", capOps: "" }));
                    }}
                    error={capErrors.capRoleId}
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <MultiSelect
                    label="Operators"
                    name="capOps"
                    options={employees
                      .filter((emp) => {
                        if (!capRoleId) return true;
                        const empRoleId = emp.roleId || emp.role?.id || emp.designationId;
                        if (empRoleId && String(empRoleId) === capRoleId) return true;
                        const matchedRole = roles.find(
                          (r) => String(r.id || r.roleId || r.code) === capRoleId
                        );
                        if (
                          matchedRole &&
                          (emp.role?.name === matchedRole.name ||
                            emp.roleName === matchedRole.name ||
                            emp.designation?.name === matchedRole.name)
                        )
                          return true;
                        return false;
                      })
                      .map((emp) => ({ value: String(emp.id), label: emp.fullName }))}
                    value={capOps}
                    onChange={(_, vals) => {
                      setCapOps(vals);
                      setCapErrors((prev) => ({ ...prev, capOps: "" }));
                    }}
                    placeholder={capRoleId ? "Select operators" : "Select role first"}
                    error={capErrors.capOps}
                  />
                </div>
                <div>
                  <TextInput
                    label="New Capacity / Shift"
                    name="capQty"
                    type="number"
                    step="any"
                    value={capQty}
                    placeholder="0"
                    onChange={(e) => {
                      setCapQty(e.target.value);
                      setCapErrors((prev) => ({ ...prev, capQty: "" }));
                    }}
                    error={capErrors.capQty}
                    required
                  />
                </div>
              </div>
            </div>
          </CommonModal>
        )}
      </div>
    </div>
  );
};

export default ProductList;
