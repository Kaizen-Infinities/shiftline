import React, { useEffect, useState, useCallback } from "react";
import { Modal } from "../../../components/ui/TailwindPrimitives";
import { FaPlus } from "react-icons/fa";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";

import { salesOrderService, type SalesOrder } from "../../../services/salesOrderService";
import { productionOrderService } from "../../../services/productionOrderService";
import IconButton from "../../../components/ui/IconButton/IconButton";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";

const ApprovedSalesOrderList: React.FC = () => {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedViewOrder, setSelectedViewOrder] = useState<SalesOrder | null>(null);
  const [orderProductionStages, setOrderProductionStages] = useState<Record<string, string>>({});
  const [loadingStages, setLoadingStages] = useState(false);

  usePageShortcuts({ onRefresh: () => fetchOrders() });

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await salesOrderService.fetchAll({
        status: "IN_PRODUCTION",
      });

      let filteredData = response.data || [];

      filteredData = filteredData.filter(
        (o) =>
          o.productionStatus !== "PRODUCTION_CREATED" &&
          o.productionStatus !== "IN_PRODUCTION" &&
          o.productionStatus !== "PRODUCTION_DRAFT"
      );

      if (searchTerm) {
        const lowerTerm = searchTerm.toLowerCase();
        filteredData = filteredData.filter(
          (o) =>
            o.orderNo?.toLowerCase().includes(lowerTerm) ||
            o.customer?.firmName?.toLowerCase().includes(lowerTerm)
        );
      }

      setOrders(filteredData);
    } catch (err: any) {
      console.error("Error fetching approved sales orders", err);
      setError(err?.response?.data?.message || "Failed to load approved sales orders.");
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  }, []);

  const handleCreateProductionOrder = useCallback(
    (order: SalesOrder) => {
      navigate("/production-orders/create", {
        state: { sourceSalesOrderId: order.id },
      });
    },
    [navigate]
  );

  const handleViewOrder = useCallback(async (order: SalesOrder) => {
    setSelectedViewOrder(order);
    setShowViewModal(true);
    setOrderProductionStages({});
    setLoadingStages(true);
    try {
      const res = await productionOrderService.fetchAll({
        sourceSalesOrderId: order.id.toString(),
      });
      const stages: Record<string, string> = {};
      const prodOrders = res.data || [];
      prodOrders.forEach((po) => {
        if (po.productItemId) {
          stages[po.productItemId.toString()] = po.status || "PLANNED";
        }
      });
      setOrderProductionStages(stages);
    } catch (error) {
      console.error("Failed to fetch production stages", error);
      toast.error("Failed to fetch production stages");
    } finally {
      setLoadingStages(false);
    }
  }, []);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "N/A";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  return (
    <div>
      <div className="max-w-[1100px] xl:mr-auto bg-card rounded-sm border border-line overflow-hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 px-5 py-3 border-b border-line">
          <div>
            <h2 className="text-base font-bold text-ink">Approved Sales Orders</h2>
          </div>
          <div className="relative w-full md:w-64">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
              size={15}
            />
            <input
              type="text"
              data-search-input
              className="w-full pl-10 pr-4 py-2 bg-card-2 border border-line-soft rounded-sm text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
              placeholder="Search orders..."
              value={searchTerm}
              onChange={handleSearch}
            />
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 rounded-sm border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-4 py-3 text-sm text-[color:var(--color-danger)]">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead className="bg-card-2 border-b border-line text-ink-muted">
              <tr>
                <th className="p-3 font-semibold w-[60px]">#</th>
                <th className="p-3 font-semibold">ORDER NO</th>
                <th className="p-3 font-semibold">ORDER DATE</th>
                <th className="p-3 font-semibold">END DATE</th>
                <th className="p-3 font-semibold">PRIORITY</th>
                <th className="p-3 font-semibold">CUSTOMER</th>
                <th className="p-3 font-semibold">REMARKS</th>
                <th className="p-3 font-semibold">PRODUCTION STATUS</th>
                <th className="p-3 font-semibold">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft bg-card">
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center p-4 text-ink-muted">
                    <div className="inline-flex items-center gap-2">
                      <div className="animate-spin rounded-full border-b-2 border-accent h-4 w-4"></div>
                      Loading approved sales orders...
                    </div>
                  </td>
                </tr>
              ) : orders.length > 0 ? (
                orders.map((order, index) => {
                  return (
                    <tr key={order.id} className="hover:bg-card-2 transition-colors">
                      <td className="p-3 text-ink-muted">{index + 1}</td>
                      <td className="p-3 font-semibold text-ink">{order.orderNo}</td>
                      <td className="p-3 text-ink-muted">{formatDate(order.orderDate)}</td>
                      <td className="p-3 text-ink-muted">
                        {(order as any).expectedCompletionDate
                          ? formatDate((order as any).expectedCompletionDate)
                          : "-"}
                      </td>
                      <td className="p-3 text-ink-muted">{order.dispatchType || "-"}</td>
                      <td className="p-3 text-ink-muted">{order.customer?.firmName || "-"}</td>
                      <td className="p-3 text-ink-muted">{order.remarks || "-"}</td>
                      <td className="p-3">
                        <StatusBadge
                          status={
                            order.productionStatus === "NOT_STARTED" || !order.productionStatus
                              ? "PENDING"
                              : order.productionStatus
                          }
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <ViewButton onClick={() => handleViewOrder(order)} />
                          <IconButton
                            variant="primary"
                            title="Plan Production"
                            icon={FaPlus}
                            onClick={() => handleCreateProductionOrder(order)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="text-center p-4 text-ink-muted">
                    No approved sales orders found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order View Modal */}
      <Modal show={showViewModal} onHide={() => setShowViewModal(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Sales Order Details</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedViewOrder ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-xs text-ink-subtle">Order No</div>
                  <div className="text-sm font-semibold text-ink">{selectedViewOrder.orderNo}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-subtle">Customer</div>
                  <div className="text-sm font-semibold text-ink">
                    {selectedViewOrder.customer?.firmName || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-subtle">Order Date</div>
                  <div className="text-sm font-semibold text-ink">
                    {formatDate(selectedViewOrder.orderDate)}
                  </div>
                </div>
              </div>
              <h6 className="text-sm font-bold text-ink mb-2">Products & Production Stage</h6>
              <div className="border border-line rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="bg-card-2 border-b border-line text-ink-muted">
                    <tr>
                      <th className="p-2 font-semibold">PRODUCT CODE</th>
                      <th className="p-2 font-semibold">PRODUCT NAME</th>
                      <th className="p-2 font-semibold">ORDERED QTY</th>
                      <th className="p-2 font-semibold">PRODUCTION STAGE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft bg-card">
                    {selectedViewOrder.items?.map((item, idx) => (
                      <tr key={idx} className="hover:bg-card-2 transition-colors">
                        <td className="p-2 text-ink-muted">{item.product?.productCode || "-"}</td>
                        <td className="p-2 text-ink-muted">{item.product?.productName || "-"}</td>
                        <td className="p-2 text-ink-muted">
                          {item.quantity} {(item.product as any)?.uom?.name || "PCS"}
                        </td>
                        <td className="p-2">
                          {loadingStages ? (
                            <div className="animate-spin rounded-full border-b-2 border-accent h-4 w-4"></div>
                          ) : (
                            <StatusBadge
                              status={
                                orderProductionStages[item.productId.toString()] || "NOT_STARTED"
                              }
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="text-ink-muted text-center p-4">No order selected.</div>
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
};

export default ApprovedSalesOrderList;
