import apiClient from "../api/apiClient";
import config from "../api/config";

/** A node of the chart-of-accounts tree (P1-09c). */
export interface LedgerGroupNode {
  id: number;
  code: string;
  name: string;
  nature: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | "EQUITY";
  parentId: number | null;
  scheduleHead: string | null;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  ledgerCount: number;
  children: LedgerGroupNode[];
  /** Only on the flat listing: "Current Assets › Bank Accounts". */
  path?: string;
}

export interface AccountLedger {
  id: number;
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | "EQUITY";
  group: string;
  groupId?: number | null;
  ledgerGroup?: {
    id: number;
    code: string;
    name: string;
    scheduleHead: string | null;
    parentId: number | null;
  } | null;
  isActive: boolean;
  customerId?: string | null;
  supplierId?: number | null;
  customer?: {
    id: string;
    firmName: string;
    displayName?: string | null;
    customerCode: string;
    customerGrade?: { name: string } | null;
    customerType?: { name: string } | null;
  } | null;
  supplier?: {
    id: number;
    legalName: string;
    displayName?: string | null;
    supplierCode: string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateLedgerDto {
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | "EQUITY";
  /** Group id from the tree; `group` (a name) is accepted for older callers. */
  groupId?: number | null;
  group?: string;
  isActive?: boolean;
  openingBalance?: number;
  openingBalanceType?: "DEBIT" | "CREDIT";
}

export interface LedgerStatementEntry {
  id: string;
  voucherId?: number | string;
  voucherNo: string;
  voucherType: string;
  refDocType?: string | null;
  refDocId?: string | null;
  date: string;
  narration: string;
  particulars: string;
  accountName?: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface LedgerStatementResult {
  ledger: AccountLedger;
  mode?: "one";
  startDate?: string | null;
  endDate?: string | null;
  openingBalance: number;
  closingBalance: number;
  entries: LedgerStatementEntry[];
}

export interface MultiLedgerStatementResult {
  mode: "multi";
  label: string;
  ledgerIds: number[];
  ledgerCount: number;
  startDate?: string | null;
  endDate?: string | null;
  openingBalance: number;
  closingBalance: number;
  entries: LedgerStatementEntry[];
  // Per-account opening / closing balances keyed by account name — used to
  // render Busy-style "Closing Balance" rows per account section.
  accountBalances?: Record<
    string,
    {
      name: string;
      opening: number;
      openingSide: "Dr" | "Cr";
      closing: number;
      closingSide: "Dr" | "Cr";
    }
  >;
}

export const accountService = {
  fetchLedgers: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    type?: string;
    group?: string;
    grouped?: boolean;
  }): Promise<{
    ledgers: AccountLedger[];
    grouped: Array<{ group: string; ledgers: AccountLedger[] }> | null;
    total: number;
    page: number;
    totalPages: number;
  }> => {
    const response = await apiClient.get("/accounts/ledgers", { params });
    const data = response.data?.data || response.data;
    const grouped = response.data?.grouped ?? null;
    const pagination = response.data?.pagination;
    if (Array.isArray(data)) {
      return { ledgers: data, grouped, total: data.length, page: 1, totalPages: 1 };
    }
    return {
      ledgers: data || [],
      grouped,
      total: pagination?.totalItems || 0,
      page: pagination?.currentPage || 1,
      totalPages: pagination?.totalPages || 1,
    };
  },

  fetchLedgerById: async (id: number): Promise<AccountLedger> => {
    const response = await apiClient.get(`/accounts/ledgers/${id}`);
    return response.data?.data || response.data;
  },

  /** Chart-of-accounts tree (P1-09c); `flat` returns every node with its path. */
  fetchGroups: async (flat = false): Promise<LedgerGroupNode[]> => {
    const response = await apiClient.get("/accounts/groups", {
      params: flat ? { flat: "true" } : {},
    });
    return response.data?.data ?? [];
  },

  createGroup: async (data: {
    name: string;
    parentId: number;
    code?: string;
  }): Promise<LedgerGroupNode> => {
    const response = await apiClient.post("/accounts/groups", data);
    return response.data?.data;
  },

  createLedger: async (data: CreateLedgerDto): Promise<AccountLedger> => {
    const response = await apiClient.post("/accounts/ledgers", data);
    return response.data?.data || response.data;
  },

  updateLedger: async (id: number, data: Partial<CreateLedgerDto>): Promise<AccountLedger> => {
    const response = await apiClient.patch(`/accounts/ledgers/${id}`, data);
    return response.data?.data || response.data;
  },

  /**
   * Set (or reset) the opening balance of a bank / cash ledger.
   * The backend posts an idempotent JV against Opening Balance Equity —
   * customer / supplier ledgers are never touched.
   */
  setBankOpeningBalance: async (
    id: number,
    openingBalance: number
  ): Promise<{ ledgerId: number; openingBalance: number }> => {
    const response = await apiClient.post(`/accounts/ledgers/${id}/opening-balance`, {
      openingBalance,
    });
    return response.data?.data || response.data;
  },

  /**
   * Repair legacy customer/supplier opening balance vouchers whose contra
   * side was wrongly routed to a bank/cash ledger. Safe to call any number
   * of times — a no-op after the first successful run.
   */
  repairPartyOpeningVouchers: async (): Promise<{ removed: number; ok: boolean }> => {
    const response = await apiClient.post(`/accounts/repair-opening-vouchers`);
    return response.data?.data || response.data;
  },

  fetchStatement: async (
    id: number,
    params?: { startDate?: string; endDate?: string; search?: string }
  ): Promise<LedgerStatementResult> => {
    // No ledger picked yet (0, NaN): there is nothing to fetch, and asking would only 404.
    if (!Number.isInteger(id) || id <= 0) throw new Error("No ledger selected");
    const response = await apiClient.get(`/accounts/ledgers/${id}/statement`, { params });
    return response.data?.data || response.data;
  },

  /**
   * Combined ledger statement for multiple accounts.
   * Pass EITHER `ids` (comma-separated ledger ids) OR `group` (group name = all ledgers in that group).
   * Omit both to get "All Accounts" combined view.
   */
  fetchMultiStatement: async (params?: {
    ids?: number[];
    group?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    label?: string;
  }): Promise<MultiLedgerStatementResult> => {
    const query: Record<string, string> = {};
    if (params?.ids && params.ids.length > 0) query.ids = params.ids.join(",");
    if (params?.group) query.group = params.group;
    if (params?.startDate) query.startDate = params.startDate;
    if (params?.endDate) query.endDate = params.endDate;
    if (params?.search) query.search = params.search;
    if (params?.label) query.label = params.label;
    const response = await apiClient.get(`/accounts/ledger-statement/multi`, { params: query });
    return response.data?.data || response.data;
  },
};
