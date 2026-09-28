import React, { useState, useMemo, useCallback } from "react";
import { ActionPill, PageHeader, SearchField } from "../../../components/ui/v2";
import { Plus, Clock } from "lucide-react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CustomButton from "../../../components/ui/Button/Button";
import CommonViewModal from "../../../components/ui/CommonViewModal/CommonViewModal";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";

import type { Shift } from "../../../features/shifts/types";
import { shiftService } from "../../../services/shiftService";
import { usePermission } from "../../../hooks/usePermission";
import { useListCache } from "../../../hooks/useListCache";

const ITEMS_PER_PAGE = 15;

const formatTime12h = (time24: string): string => {
  if (!time24) return "N/A";
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
};

const calculateWorkingHours = (
  startTime: string,
  endTime: string,
  breakDuration: string | number | null | undefined
): string => {
  if (!startTime || !endTime) return "N/A";
  try {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);

    const startMinutes = sh * 60 + sm;
    let endMinutes = eh * 60 + em;

    if (endMinutes < startMinutes) {
      endMinutes += 24 * 60; // Next day
    }

    let diffMinutes = endMinutes - startMinutes;

    if (breakDuration) {
      diffMinutes -= Number(breakDuration);
    }

    if (diffMinutes < 0) diffMinutes = 0;

    const hrs = diffMinutes / 60;
    return `${hrs.toFixed(1).replace(/\.0$/, "")} hrs`;
  } catch (e) {
    return "N/A";
  }
};

const ShiftList: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();
  const canCreateShift = can("shifts.create");
  const canEditShift = can("shifts.edit");
  const canDeleteShift = can("shifts.delete");
  const canExportShift = can("shifts.export");

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Shift | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const list = await shiftService.fetchAll();
    return { data: list, total: list.length };
  }, []);

  const {
    data,
    loading,
    refresh,
    error: listError,
  } = useListCache<Shift>({
    cacheKey: "shifts:list",
    socketModule: "shift",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const filteredData = useMemo(() => {
    return data.filter(
      (item) =>
        item.shiftCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.shiftName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [data, searchTerm]);

  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedData = filteredData.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  // CSV Export Configuration
  const { csvData, csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Shift Code", accessor: (item: any) => item.shiftCode },
      { header: "Shift Name", accessor: (item: any) => item.shiftName },
      { header: "Start Time", accessor: (item: any) => formatTime12h(item.startTime) },
      { header: "End Time", accessor: (item: any) => formatTime12h(item.endTime) },
      {
        header: "Break Duration",
        accessor: (item: any) => (item.breakDuration ? `${item.breakDuration} mins` : "—"),
      },
      {
        header: "Working Hours",
        accessor: (item: any) =>
          calculateWorkingHours(item.startTime, item.endTime, item.breakDuration),
      },
      { header: "Status", accessor: (item: any) => (item.isActive ? "ACTIVE" : "INACTIVE") },
    ];
    return {
      csvData: data,
      csvColumns: columns,
      csvFilename: `Shift_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, [data]);

  const handleOpenView = useCallback((item: Shift) => {
    setSelectedItem(item);
    setShowViewModal(true);
  }, []);

  const handleOpenAdd = () => {
    navigate("/shifts/create");
  };

  const handleOpenEdit = useCallback(
    (item: Shift) => {
      navigate(`/shifts/edit/${item.id}`, { state: item });
    },
    [navigate]
  );

  const triggerDelete = useCallback((id: number) => {
    setItemToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (itemToDelete !== null && !isDeleting) {
      setIsDeleting(true);
      try {
        await shiftService.delete(itemToDelete);
        toast.success("Shift deleted successfully!");
        refresh();
      } catch (err: any) {
        toast.error(err?.response?.data?.message || err.message || err || "Failed to delete shift");
      } finally {
        setShowDeleteModal(false);
        setItemToDelete(null);
        setIsDeleting(false);
      }
    }
  };

  return (
    <div>
      <div>
        <div className="mx-auto w-full max-w-[1480px] space-y-5 py-1 sm:py-2">
          <PageHeader
            title="Shift Management"
            icon={<Clock size={20} />}
            subtitle="Shift timings used by attendance, overtime and the daily plan."
            actions={
              <>
                {canExportShift && (
                  <ExportCSVButton
                    data={csvData}
                    columns={csvColumns}
                    filename={csvFilename}
                    text="Export"
                  />
                )}
              </>
            }
            primaryAction={
              canCreateShift ? (
                <ActionPill icon={<Plus size={17} />} onClick={handleOpenAdd}>
                  Add Shift
                </ActionPill>
              ) : undefined
            }
          />
          <SearchField
            value={searchTerm}
            onValueChange={(v) =>
              handleSearch({ target: { value: v } } as React.ChangeEvent<HTMLInputElement>)
            }
            placeholder="Search shifts..."
            data-search-input
          />

          {/* Table */}
          <div>
            <DataTable
              error={listError}
              sourceRowCount={data.length}
              onRetry={refresh}
              data={paginatedData}
              rowKey={(item) => item.id}
              loading={loading}
              emptyMessage="No shifts found."
              pagination={
                totalPages > 1
                  ? {
                      currentPage,
                      totalPages,
                      onPageChange: (page) => setCurrentPage(page),
                    }
                  : undefined
              }
              columns={[
                {
                  header: "#",
                  width: "60px",
                  render: (_item, index) => startIndex + index + 1,
                  align: "center",
                },
                { header: "SHIFT CODE", accessor: "shiftCode" },
                { header: "SHIFT NAME", accessor: "shiftName" },
                { header: "START TIME", render: (item) => formatTime12h(item.startTime) },
                { header: "END TIME", render: (item) => formatTime12h(item.endTime) },
                {
                  header: "BREAK DURATION",
                  render: (item) => (item.breakDuration ? `${item.breakDuration} mins` : "N/A"),
                },
                {
                  header: "WORKING HOURS",
                  render: (item) =>
                    calculateWorkingHours(item.startTime, item.endTime, item.breakDuration),
                },
                {
                  header: "STATUS",
                  render: (item) => <StatusBadge status={item.isActive ? "ACTIVE" : "INACTIVE"} />,
                  align: "center",
                },
                {
                  header: "ACTIONS",
                  render: (item) => (
                    <div className="flex items-center gap-2">
                      <ViewButton onClick={() => handleOpenView(item)} />
                      {canEditShift && <EditButton onClick={() => handleOpenEdit(item)} />}
                      {canDeleteShift && <DeleteButton onClick={() => triggerDelete(item.id)} />}
                    </div>
                  ),
                  align: "center",
                },
              ]}
            />
          </div>
        </div>

        {/* View Modal */}
        <CommonViewModal
          show={showViewModal}
          onHide={() => setShowViewModal(false)}
          modalTitle="Shift Details"
          avatarText={selectedItem ? selectedItem.shiftName.charAt(0).toUpperCase() : ""}
          headerTitle={selectedItem ? selectedItem.shiftName : ""}
          headerSubtitle={selectedItem ? `Code: ${selectedItem.shiftCode}` : ""}
          sections={
            selectedItem
              ? [
                  {
                    fields: [
                      { label: "Shift Code", value: selectedItem.shiftCode },
                      { label: "Shift Name", value: selectedItem.shiftName },
                      { label: "Start Time", value: formatTime12h(selectedItem.startTime) },
                      { label: "End Time", value: formatTime12h(selectedItem.endTime) },
                    ],
                  },
                  {
                    title: "Break & Grace",
                    fields: [
                      {
                        label: "Break Duration",
                        value: selectedItem.breakDuration
                          ? `${selectedItem.breakDuration} mins`
                          : "N/A",
                      },
                      {
                        label: "Grace Period",
                        value: selectedItem.gracePeriod
                          ? `${selectedItem.gracePeriod} mins`
                          : "N/A",
                      },
                      {
                        label: "Working Hours",
                        value: calculateWorkingHours(
                          selectedItem.startTime,
                          selectedItem.endTime,
                          selectedItem.breakDuration
                        ),
                      },
                      { label: "Status", value: selectedItem.isActive ? "Active" : "Inactive" },
                    ],
                  },
                ]
              : []
          }
        />

        {/* Delete Modal */}
        <CommonConfirmModal
          show={showDeleteModal}
          onHide={() => setShowDeleteModal(false)}
          onConfirm={handleDeleteConfirm}
          title="Confirm Delete"
          message="Are you sure you want to delete this shift?"
          confirmText={isDeleting ? "Deleting..." : "Delete"}
          confirmVariant="danger"
        />
      </div>
    </div>
  );
};

export default ShiftList;
