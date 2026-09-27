import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchProductionWastages,
  deleteProductionWastage,
  approveProductionWastage,
  rejectProductionWastage,
  productionWastageCreated,
  productionWastageUpdated,
  productionWastageDeleted,
} from "../../../features/production-wastage/productionWastageSlice";
import { useSocketSync } from "../../../hooks/useSocketSync";
import { fetchMachines } from "../../../features/machines/machineSlice";
import { fetchProducts } from "../../../features/product/productSlice";
import { fetchShifts } from "../../../features/shifts/shiftSlice";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import WastageViewModal from "../components/WastageViewModal";
import DataTable from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { productionWastageService } from "../../../services/productionWastageService";
import { usePermission } from "../../../hooks/usePermission";
import { Plus, Recycle } from "lucide-react";
import { ActionPill, Chip, PageHeader } from "../../../components/ui/v2";
import { PageBody, RowActions, formatQty } from "../../production/ui";
import { formatDate } from "../../../utils/dateUtils";
const ITEMS_PER_PAGE = 15;

const WastageList: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  // Redux state
  const {
    data: wastages,
    loading,
    error,
    total,
  } = useAppSelector((state) => state.productionWastages);
  const { data: machines } = useAppSelector((state) => state.machines);
  const { products } = useAppSelector((state: any) => state.products || { products: [] });
  const { data: shifts } = useAppSelector((state) => state.shifts);

  // Modals state
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedWastage, setSelectedWastage] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  usePageShortcuts({
    onRefresh: () =>
      dispatch(fetchProductionWastages({ page: currentPage, limit: ITEMS_PER_PAGE })),
    onDelete: () => setShowDeleteModal(true),
  });

  useEffect(() => {
    dispatch(
      fetchProductionWastages({
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      })
    );
  }, [dispatch, currentPage]);

  useSocketSync<any>("productionWastage", {
    created: productionWastageCreated,
    updated: productionWastageUpdated,
    deleted: productionWastageDeleted,
  });

  useEffect(() => {
    dispatch(fetchMachines());
    dispatch(fetchProducts(undefined));
    dispatch(fetchShifts());
  }, [dispatch]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleDeleteClick = useCallback((id: string) => {
    setItemToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (itemToDelete && !isDeleting) {
      setIsDeleting(true);
      try {
        await dispatch(deleteProductionWastage(itemToDelete)).unwrap();
        toast.success("Production wastage log deleted successfully");
      } catch (err: any) {
        toast.error(err || "Failed to delete log");
      } finally {
        setIsDeleting(false);
        setShowDeleteModal(false);
        setItemToDelete(null);
      }
    }
  };

  const handleApprove = useCallback(
    async (id: string) => {
      try {
        await dispatch(approveProductionWastage(id)).unwrap();
        toast.success("Wastage log approved successfully");
        if (selectedWastage && String(selectedWastage.id) === String(id)) {
          setShowViewModal(false);
        }
      } catch (err: any) {
        toast.error(err || "Failed to approve log");
      }
    },
    [dispatch, selectedWastage]
  );

  const handleReject = useCallback(
    async (id: string) => {
      try {
        await dispatch(rejectProductionWastage(id)).unwrap();
        toast.success("Wastage log rejected successfully");
        if (selectedWastage && String(selectedWastage.id) === String(id)) {
          setShowViewModal(false);
        }
      } catch (err: any) {
        toast.error(err || "Failed to reject log");
      }
    },
    [dispatch, selectedWastage]
  );

  const handleView = useCallback((wastage: any) => {
    setSelectedWastage(wastage);
    setShowViewModal(true);
  }, []);

  const fetchWastagesForExport = useCallback(async () => {
    try {
      const res = await productionWastageService.getAll({ page: 1, limit: 100000 });
      const list = Array.isArray(res) ? res : res?.data || [];
      if (Array.isArray(list) && list.length > 0) return list;
    } catch {
      // fallback
    }
    return Array.isArray(wastages) ? wastages : [];
  }, [wastages]);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      {
        header: "Date",
        accessor: (item: any) =>
          item.wastageDate ? new Date(item.wastageDate).toLocaleDateString("en-IN") : "",
      },
      { header: "PO Reference", accessor: (item: any) => item.productionOrderId || "" },
      {
        header: "Product",
        accessor: (item: any) => item.product?.productName || item.productId || "",
      },
      {
        header: "Machine",
        accessor: (item: any) => item.machine?.machineName || item.machineId || "",
      },
      { header: "Shift", accessor: (item: any) => item.shift?.shiftName || item.shiftId || "" },
      {
        header: "Quantity",
        accessor: (item: any) =>
          `${item.quantity || 0} ${
            item.uom && item.uom.toUpperCase() === "PCS"
              ? "kg"
              : String(item.uom || "kg")
                  .split(",")[0]
                  .toLowerCase()
          }`,
      },
      { header: "Reason", accessor: (item: any) => item.reason || "" },
      { header: "Status", accessor: (item: any) => item.status || "" },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Production_Wastage_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const totalPages = Math.ceil((total || 0) / ITEMS_PER_PAGE) || 1;
  const displayWastages = wastages || [];

  const uomLabel = (item: any) =>
    item.uom && item.uom.toUpperCase() === "PCS"
      ? "kg"
      : String(item.uom || "kg")
          .split(",")[0]
          .toLowerCase();

  const recordButton = can("production-wastages.create") ? (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/production-wastages/create")}>
      Record Wastage
    </ActionPill>
  ) : null;

  return (
    <PageBody>
      <PageHeader
        title="Production Wastage"
        icon={<Recycle size={22} />}
        subtitle={`Production Wastage Auditing · ${total || 0} log${total === 1 ? "" : "s"}; drafts can be edited until approved.`}
        actions={
          can("production-wastages.export") ? (
            <ExportCSVButton
              fetchData={fetchWastagesForExport}
              columns={csvColumns}
              filename={csvFilename}
              text="Export"
            />
          ) : undefined
        }
        primaryAction={recordButton}
      />

      <DataTable
        ariaLabel="Production wastage logs"
        data={displayWastages}
        rowKey={(item) => String(item.id)}
        loading={loading}
        pagination={{
          currentPage,
          totalPages,
          onPageChange: (page) => setCurrentPage(page),
        }}
        columns={[
          {
            header: "Date",
            render: (item: any) => (
              <span className="font-medium text-ink tabular-nums">
                {formatDate(item.wastageDate)}
              </span>
            ),
          },
          {
            header: "PO reference",
            render: (item: any) =>
              item.productionOrderId ? (
                <button
                  type="button"
                  onClick={() => handleView(item)}
                  className="font-mono text-[13px] font-semibold text-accent underline-offset-4 hover:underline"
                >
                  {item.productionOrderId}
                </button>
              ) : (
                <span className="text-ink-subtle">—</span>
              ),
          },
          {
            header: "Product",
            render: (item: any) => (
              <span className="block max-w-[220px] truncate font-medium text-ink">
                {item.product?.productName || item.productId}
              </span>
            ),
          },
          {
            header: "Machine · shift",
            render: (item: any) => (
              <div className="flex flex-col">
                <span className="text-ink">{item.machine?.machineName || item.machineId}</span>
                <span className="sl-muted text-[12px]">
                  {item.shift?.shiftName || item.shiftId}
                </span>
              </div>
            ),
          },
          {
            header: "Quantity",
            align: "right",
            render: (item: any) => (
              <span className="font-bold text-ink tabular-nums">
                {formatQty(item.quantity, uomLabel(item))}
              </span>
            ),
          },
          {
            header: "Reason",
            render: (item: any) =>
              item.reason ? (
                <Chip size="sm" tone="muted" title={item.reason} className="max-w-[180px]">
                  <span className="truncate">{item.reason}</span>
                </Chip>
              ) : (
                <span className="text-ink-subtle">—</span>
              ),
          },
          {
            header: "Status",
            render: (item: any) => <StatusBadge status={item.status} />,
          },
          {
            header: "Actions",
            align: "right",
            render: (item: any) => (
              <RowActions>
                <span className="contents" onClick={(e) => e.stopPropagation()}>
                  <ViewButton onClick={() => handleView(item)} />
                  {item.status === "DRAFT" && (
                    <>
                      <EditButton
                        onClick={() =>
                          navigate(`/production-wastages/edit/${item.id}`, { state: item })
                        }
                      />
                      <DeleteButton onClick={() => handleDeleteClick(String(item.id))} />
                    </>
                  )}
                </span>
              </RowActions>
            ),
          },
        ]}
        emptyMessage="No wastage logs yet. Record scrap and rejects here so stock and OEE stay honest."
        emptyAction={recordButton}
      />

      {/* Delete Confirmation Modal */}
      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Wastage Log"
        message="Are you sure you want to delete this wastage log? This action cannot be undone."
        confirmText={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        isDangerous={true}
      />

      <WastageViewModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        wastage={selectedWastage}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </PageBody>
  );
};

export default WastageList;
