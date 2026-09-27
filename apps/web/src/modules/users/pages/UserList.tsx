import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ActionPill, PageHeader, SearchField } from "../../../components/ui/v2";
import { Plus, UserCog } from "lucide-react";
import { Search } from "lucide-react";
import { FaSave } from "react-icons/fa";
import { toast } from "react-toastify";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import CustomButton from "../../../components/ui/Button/Button";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { useUsers } from "../../../hooks/useUsers";
import CommonViewModal from "../../../components/ui/CommonViewModal/CommonViewModal";
import CommonModal from "../../../components/ui/Modal/CommonModal";
import { usePermission } from "../../../hooks/usePermission";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { userService } from "../../../services/userService";

const ITEMS_PER_PAGE = 15;

const UserList: React.FC = () => {
  const { users, loading, error, loadUsers, changeUserStatus } = useUsers();
  const { can } = usePermission();
  const canEdit = can("users.edit");
  const canCreate = can("users.create");

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);

  const [formData, setFormData] = useState({
    username: "",
    fullName: "",
    isActive: "true",
  });

  usePageShortcuts({ onRefresh: () => loadUsers() });

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const filteredUsers = useMemo(() => {
    const filtered = users.filter(
      (user) =>
        user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (user.email && user.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (user.roleId && user.roleId.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    // Sort ascending by createdOn so last added comes last
    return [...filtered].sort((a, b) => {
      const dateA = a.createdOn ? new Date(a.createdOn).getTime() : 0;
      const dateB = b.createdOn ? new Date(b.createdOn).getTime() : 0;
      return dateA - dateB;
    });
  }, [users, searchTerm]);

  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedUsers = filteredUsers.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const fetchUsersForExport = useCallback(async () => {
    try {
      const list = await userService.fetchAll();
      return Array.isArray(list) ? list : [];
    } catch {
      return users;
    }
  }, [users]);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Username", accessor: (item: any) => item.username || "" },
      { header: "Full Name", accessor: (item: any) => item.fullName || "" },
      { header: "Email", accessor: (item: any) => item.email || "" },
      { header: "Role", accessor: (item: any) => item.roleId || "" },
      {
        header: "Status",
        accessor: (item: any) => item.status || (item.isActive ? "Active" : "Inactive"),
      },
    ];
    return {
      csvColumns: columns,
      csvFilename: `System_Users_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const handleOpenEdit = (user: any) => {
    setSelectedUser(user);
    setFormData({
      username: user.username,
      fullName: user.fullName,
      isActive: user.status === "active" ? "true" : "false",
    });
    setShowFormModal(true);
  };

  const handleOpenView = (user: any) => {
    setSelectedUser(user);
    setShowViewModal(true);
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
      if (selectedUser) {
        await changeUserStatus(selectedUser.userId, formData.isActive === "true");
        toast.success("User status updated successfully!");
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
    { header: "Username", accessor: "username" },
    { header: "Full Name", accessor: "fullName" },
    { header: "Email", render: (user) => user.email || "N/A" },
    { header: "Role", accessor: "roleId" },
    { header: "Status", render: (user) => <StatusBadge status={user.status} />, align: "center" },
    {
      header: "Actions",
      width: "100px",
      align: "center",
      render: (user) => (
        <div className="flex items-center gap-2">
          <ViewButton onClick={() => handleOpenView(user)} />
          {canEdit && <EditButton onClick={() => handleOpenEdit(user)} />}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mx-auto w-full max-w-[1480px] space-y-5 py-1 sm:py-2">
        <PageHeader
          title="User Management"
          icon={<UserCog size={20} />}
          subtitle="Everyone who can sign in to this company."
          actions={
            <>
              {can("users.export") && (
                <ExportCSVButton
                  fetchData={fetchUsersForExport}
                  columns={csvColumns}
                  filename={csvFilename}
                  text="Export"
                />
              )}
            </>
          }
          primaryAction={undefined}
        />
        <SearchField
          value={searchTerm}
          onValueChange={(v) =>
            handleSearch({ target: { value: v } } as React.ChangeEvent<HTMLInputElement>)
          }
          placeholder="Search users..."
          data-search-input
        />

        {/* Users Table */}
        <div>
          <DataTable
            columns={columns}
            data={paginatedUsers}
            rowKey={(row) => row.userId}
            loading={loading}
            emptyMessage="No users found."
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

      {/* Edit Modal */}
      <CommonModal
        show={showFormModal}
        onHide={() => setShowFormModal(false)}
        title="Edit User Status"
        overflowVisible={true}
        footer={
          canCreate ? (
            <div className="flex items-center justify-end gap-2 w-full">
              <CustomButton text="Update" icon={FaSave} onClick={handleSubmit} disabled={loading} />
            </div>
          ) : undefined
        }
      >
        <form id="userStatusForm" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <TextInput
              label="Username"
              name="username"
              value={formData.username}
              disabled
              onChange={handleChange}
            />
            <TextInput
              label="Full Name"
              name="fullName"
              value={formData.fullName}
              disabled
              onChange={handleChange}
            />
            <SelectInput
              label="Status"
              name="isActive"
              value={formData.isActive}
              options={[
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive/Suspended" },
              ]}
              onChange={handleChange}
            />
          </div>
        </form>
      </CommonModal>

      {/* View Details Modal */}
      <CommonViewModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        modalTitle="User Details"
        avatarText={selectedUser ? selectedUser.fullName.charAt(0).toUpperCase() : ""}
        headerTitle={selectedUser ? selectedUser.fullName : ""}
        headerSubtitle={selectedUser ? `@${selectedUser.username}` : ""}
        sections={
          selectedUser
            ? [
                {
                  fields: [
                    { label: "Role", value: selectedUser.roleId || "N/A" },
                    {
                      label: "Status",
                      value: <StatusBadge status={selectedUser.status} />,
                    },
                    { label: "Email", value: selectedUser.email || "N/A", xs: 12 },
                    {
                      label: "User ID",
                      value: (
                        <span className="text-ink-subtle tabular-nums text-xs">
                          {selectedUser.userId}
                        </span>
                      ),
                      xs: 12,
                    },
                  ],
                },
              ]
            : []
        }
      />
    </div>
  );
};

export default UserList;
