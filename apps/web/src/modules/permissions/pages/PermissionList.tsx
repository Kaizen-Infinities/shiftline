import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ActionPill, PageHeader, SearchField } from "../../../components/ui/v2";
import { Plus, KeyRound } from "lucide-react";
import { Search } from "lucide-react";
import { FaPlus, FaSave, FaEraser } from "react-icons/fa";
import { toast } from "react-toastify";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";

import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CustomButton from "../../../components/ui/Button/Button";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import CommonViewModal from "../../../components/ui/CommonViewModal/CommonViewModal";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import CommonModal from "../../../components/ui/Modal/CommonModal";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import { usePermissions } from "../../../hooks/usePermissions";

const ITEMS_PER_PAGE = 15;

const PermissionList: React.FC = () => {
  const {
    permissions,
    loading,
    error,
    loadPermissions,
    addPermission,
    editPermission,
    removePermission,
  } = usePermissions();

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedPerm, setSelectedPerm] = useState<any>(null);

  // Custom confirm delete state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [permToDelete, setPermToDelete] = useState<number | null>(null);

  usePageShortcuts({
    onRefresh: () => loadPermissions(),
    onDelete: () => setShowDeleteModal(true),
  });

  const [formData, setFormData] = useState({
    id: "",
    key: "",
    module: "users",
    action: "",
    scope: "",
    description: "",
  });

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const filteredPerms = useMemo(() => {
    return permissions.filter(
      (p) =>
        p.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.module.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [permissions, searchTerm]);

  const totalPages = Math.ceil(filteredPerms.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedPerms = filteredPerms.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleOpenAdd = () => {
    setEditMode(false);
    setFormData({
      id: "",
      key: "",
      module: "users",
      action: "",
      scope: "",
      description: "",
    });
    setShowFormModal(true);
  };

  const handleOpenEdit = useCallback((perm: any) => {
    setEditMode(true);
    setFormData({
      id: String(perm.id),
      key: perm.key,
      module: perm.module,
      action: perm.action,
      scope: perm.scope || "",
      description: perm.description || "",
    });
    setShowFormModal(true);
  }, []);

  const handleOpenView = useCallback((perm: any) => {
    setSelectedPerm(perm);
    setShowViewModal(true);
  }, []);

  const triggerDelete = useCallback((id: number) => {
    setPermToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (permToDelete !== null) {
      try {
        await removePermission(permToDelete);
        toast.success("Permission deleted successfully!");
      } catch (err: any) {
        toast.error(err.message || "Failed to delete permission");
      } finally {
        setShowDeleteModal(false);
        setPermToDelete(null);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editMode) {
        await editPermission(Number(formData.id), {
          module: formData.module,
          action: formData.action,
          scope: formData.scope || undefined,
          description: formData.description || undefined,
        });
        toast.success("Permission updated successfully!");
      } else {
        await addPermission({
          key: formData.key,
          module: formData.module,
          action: formData.action,
          scope: formData.scope || undefined,
          description: formData.description || undefined,
        });
        toast.success("Permission created successfully!");
      }
      setShowFormModal(false);
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  const columns: DataTableColumn<any>[] = [
    {
      header: "#",
      width: "60px",
      align: "center",
      render: (_, index) => (
        <span className="text-ink-subtle tabular-nums text-xs">
          {String(startIndex + index + 1).padStart(2, "0")}
        </span>
      ),
    },
    { header: "Permission Key", accessor: "key" },
    { header: "Module", accessor: "module" },
    { header: "Action", accessor: "action" },
    {
      header: "Description",
      render: (perm) => (
        <span className="block max-w-[220px] truncate" title={perm.description || ""}>
          {perm.description || "—"}
        </span>
      ),
    },
    {
      header: "Actions",
      width: "120px",
      align: "center",
      render: (perm) => (
        <div className="flex items-center gap-2">
          <ViewButton onClick={() => handleOpenView(perm)} />
          <EditButton onClick={() => handleOpenEdit(perm)} />
          <DeleteButton onClick={() => triggerDelete(perm.id)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mx-auto w-full max-w-[1480px] space-y-5 py-1 sm:py-2">
        <PageHeader
          title="Permission Management"
          icon={<KeyRound size={20} />}
          subtitle="The permission keys roles are built from."
          actions={undefined}
          primaryAction={
            <ActionPill icon={<Plus size={17} />} onClick={handleOpenAdd}>
              Add Permission
            </ActionPill>
          }
        />
        <SearchField
          value={searchTerm}
          onValueChange={(v) =>
            handleSearch({ target: { value: v } } as React.ChangeEvent<HTMLInputElement>)
          }
          placeholder="Search permissions..."
          data-search-input
        />

        {/* Permissions Table */}
        <div>
          <DataTable
            columns={columns}
            data={paginatedPerms}
            rowKey={(row) => row.id}
            loading={loading}
            emptyMessage="No permissions found."
            pagination={
              totalPages > 1
                ? {
                    currentPage,
                    totalPages,
                    onPageChange: setCurrentPage,
                  }
                : undefined
            }
          />
        </div>
      </div>

      {/* Add/Edit Modal */}
      <CommonModal
        show={showFormModal}
        onHide={() => setShowFormModal(false)}
        title={editMode ? "Edit Permission" : "Add New Permission"}
        overflowVisible={true}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            {!editMode && (
              <CustomButton
                text="Clear"
                icon={FaEraser}
                variant="secondary"
                onClick={() =>
                  setFormData({
                    id: "",
                    key: "",
                    module: "users",
                    action: "",
                    scope: "",
                    description: "",
                  })
                }
              />
            )}
            <CustomButton
              text={editMode ? "Update" : "Save"}
              icon={FaSave}
              onClick={handleSubmit}
            />
          </div>
        }
      >
        <form id="permissionForm" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <TextInput
              label="Permission Key"
              name="key"
              value={formData.key}
              placeholder="e.g. users.view"
              required
              disabled={editMode}
              onChange={handleChange}
            />
            <TextInput
              label="Action Name"
              name="action"
              value={formData.action}
              placeholder="e.g. view"
              required
              onChange={handleChange}
            />
            <SelectInput
              label="Module Name"
              name="module"
              value={formData.module}
              options={[
                { value: "customers", label: "Customers" },
                { value: "suppliers", label: "Suppliers" },
                { value: "supplierpricelist", label: "Supplier Pricing" },
                { value: "products", label: "Product Master" },
                { value: "categories", label: "Categories" },
                { value: "uoms", label: "Units of Measure (UOM)" },
                { value: "raw_materials", label: "Raw Materials" },
                { value: "raw_material_stocks", label: "Raw Material Stocks" },
                { value: "finished_goods_stocks", label: "Finished Goods Stocks" },
                { value: "stores", label: "Stores Config" },
                { value: "storage-stores", label: "Warehouses" },
                { value: "store-types", label: "Store Types" },
                { value: "locations", label: "Store Locations" },
                { value: "machines", label: "Machines List" },
                { value: "shifts", label: "Shift Schedules" },
                { value: "users", label: "System Users" },
                { value: "roles", label: "User Roles" },
                { value: "permissions", label: "Permissions Registry" },
                { value: "role-permissions", label: "Role Mappings" },
                { value: "employees", label: "Employee Directory" },
                { value: "departments", label: "Departments" },
                { value: "profile", label: "User Profile" },
                { value: "reports", label: "System Reports" },
              ]}
              onChange={handleChange}
            />
            <TextInput
              label="Scope (Optional)"
              name="scope"
              value={formData.scope}
              placeholder="e.g. global / department"
              onChange={handleChange}
            />
            <TextInput
              label="Description"
              name="description"
              value={formData.description}
              placeholder="Enter permission description"
              onChange={handleChange}
            />
          </div>
        </form>
      </CommonModal>

      {/* View Details Modal */}
      <CommonViewModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        modalTitle="Permission Details"
        avatarText={selectedPerm ? selectedPerm.key.charAt(0).toUpperCase() : ""}
        headerTitle={selectedPerm ? selectedPerm.key : ""}
        headerSubtitle={selectedPerm ? `Module: ${selectedPerm.module}` : ""}
        sections={
          selectedPerm
            ? [
                {
                  fields: [
                    { label: "Permission Key", value: selectedPerm.key },
                    { label: "Action", value: selectedPerm.action },
                    { label: "Module", value: selectedPerm.module },
                    { label: "Scope", value: selectedPerm.scope || "N/A" },
                    { label: "Description", value: selectedPerm.description || "N/A", xs: 12 },
                    {
                      label: "Permission ID",
                      value: (
                        <span className="text-ink-subtle tabular-nums text-xs">
                          {String(selectedPerm.id)}
                        </span>
                      ),
                    },
                  ],
                },
              ]
            : []
        }
      />

      {/* Custom Delete Confirm Modal */}
      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Confirm Delete"
        message="Are you sure you want to delete this permission?"
        confirmText="Delete"
        confirmVariant="danger"
      />
    </div>
  );
};

export default PermissionList;
