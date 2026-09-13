import React, { useState, useEffect, useMemo } from "react";
import { Container, Row, Col, Card } from "../../../components/ui/TailwindPrimitives";
import {
  FaChartLine,
  FaIndustry,
  FaCogs,
  FaCheckCircle,
  FaExclamationTriangle,
  FaPauseCircle,
} from "react-icons/fa";
import { oeeService } from "../../../services/oeeService";
import { toast } from "react-toastify";
import { useSocketSync } from "../../../hooks/useSocketSync";

const formatLocalDateString = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const OeeDashboard: React.FC = () => {
  const [machines, setMachines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState<string>(formatLocalDateString(new Date()));

  useEffect(() => {
    fetchMachineStatus();
    const interval = setInterval(fetchMachineStatus, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, [date]);

  const fetchMachineStatus = async () => {
    try {
      const data = await oeeService.getAllMachinesStatus(date);
      setMachines(data);
    } catch (error) {
      console.error("Failed to fetch machine statuses", error);
      toast.error("Failed to fetch OEE data");
    } finally {
      setLoading(false);
    }
  };

  // Refresh OEE data when production activity happens
  useSocketSync("hourlyProduction", undefined, fetchMachineStatus);
  useSocketSync("productionWastage", undefined, fetchMachineStatus);
  useSocketSync("dailyPlan", undefined, fetchMachineStatus);
  useSocketSync("machine", undefined, fetchMachineStatus);

  // Calculate aggregated metrics
  const aggregateMetrics = useMemo(() => {
    if (machines.length === 0) return { oee: 0, avail: 0, perf: 0, qual: 0, count: 0 };

    let totalOee = 0,
      totalAvail = 0,
      totalPerf = 0,
      totalQual = 0;
    let validCount = 0;

    let running = 0,
      idle = 0,
      breakdown = 0,
      waiting = 0;

    machines.forEach((m) => {
      if (m.currentOee !== null) {
        totalOee += m.currentOee;
        totalAvail += m.availability || 0;
        totalPerf += m.performance || 0;
        totalQual += m.quality || 0;
        validCount++;
      }

      if (m.machineStatus === "RUNNING") running++;
      else if (m.machineStatus === "IDLE") idle++;
      else if (m.machineStatus === "BREAKDOWN") breakdown++;
      else waiting++;
    });

    return {
      oee: validCount > 0 ? (totalOee / validCount).toFixed(1) : 0,
      avail: validCount > 0 ? (totalAvail / validCount).toFixed(1) : 0,
      perf: validCount > 0 ? (totalPerf / validCount).toFixed(1) : 0,
      qual: validCount > 0 ? (totalQual / validCount).toFixed(1) : 0,
      count: machines.length,
      running,
      idle,
      breakdown,
      waiting,
    };
  }, [machines]);

  const getStatusTokens = (status: string) => {
    switch (status) {
      case "RUNNING":
        return {
          text: "text-[color:var(--color-success)]",
          border: "border-[color:var(--color-success)]",
          bg: "bg-[color:var(--color-success)]/10",
        };
      case "BREAKDOWN":
        return {
          text: "text-[color:var(--color-danger)]",
          border: "border-[color:var(--color-danger)]",
          bg: "bg-[color:var(--color-danger)]/10",
        };
      case "SETUP":
        return {
          text: "text-[color:var(--color-warning)]",
          border: "border-[color:var(--color-warning)]",
          bg: "bg-[color:var(--color-warning)]/10",
        };
      case "MATERIAL_WAITING":
        return {
          text: "text-[color:var(--color-info)]",
          border: "border-[color:var(--color-info)]",
          bg: "bg-[color:var(--color-info)]/10",
        };
      default:
        return { text: "text-ink-muted", border: "border-line", bg: "bg-card-2" };
    }
  };

  const thresholdColor = (value: number) =>
    value > 85
      ? "var(--color-success)"
      : value > 60
        ? "var(--color-warning)"
        : "var(--color-danger)";

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "RUNNING":
        return <FaCheckCircle />;
      case "BREAKDOWN":
        return <FaExclamationTriangle />;
      case "IDLE":
        return <FaPauseCircle />;
      default:
        return <FaCogs />;
    }
  };

  if (loading && machines.length === 0) {
    return (
      <div className="flex justify-center items-center" style={{ minHeight: "400px" }}>
        <div className="animate-spin rounded-full border-b-2 border-accent h-8 w-8"></div>
      </div>
    );
  }

  return (
    <div className="inner-container bg-page" style={{ minHeight: "100vh", paddingBottom: "2rem" }}>
      <Container fluid>
        <div className="page-header mb-4">
          <Row className="items-center">
            <Col className="col-span-12 sm:col-span-8">
              <h2 className="page-title mb-1">
                <FaChartLine className="mr-2" /> OEE & Machine Activity Dashboard
              </h2>
              <div className="page-breadcrumb">Factory Overview & Equipment Effectiveness</div>
            </Col>
            <Col className="col-span-12 sm:col-span-4 sm:flex sm:justify-end">
              <input
                type="date"
                className="min-h-10 rounded-md border border-line bg-card px-3 py-2 font-bold text-ink-muted outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Col>
          </Row>
        </div>

        {/* Overall Aggregate OEE Card */}
        <Card className="rounded-lg mb-4">
          <Card.Body className="p-4">
            <Row className="text-center gap-4">
              <Col className="col-span-6 sm:col-span-3">
                <div className="text-ink-muted text-xs uppercase tracking-wide">Factory OEE</div>
                <div
                  className="text-5xl font-extrabold"
                  style={{ color: thresholdColor(Number(aggregateMetrics.oee)) }}
                >
                  {aggregateMetrics.oee}%
                </div>
              </Col>
              <Col className="col-span-6 sm:col-span-3 sm:border-l sm:border-line">
                <div className="text-ink-muted text-xs uppercase tracking-wide">Availability</div>
                <div className="text-4xl font-bold" style={{ color: "var(--chart-series-1)" }}>
                  {aggregateMetrics.avail}%
                </div>
              </Col>
              <Col className="col-span-6 sm:col-span-3 sm:border-l sm:border-line">
                <div className="text-ink-muted text-xs uppercase tracking-wide">Performance</div>
                <div className="text-4xl font-bold" style={{ color: "var(--chart-series-2)" }}>
                  {aggregateMetrics.perf}%
                </div>
              </Col>
              <Col className="col-span-6 sm:col-span-3 sm:border-l sm:border-line">
                <div className="text-ink-muted text-xs uppercase tracking-wide">Quality</div>
                <div className="text-4xl font-bold" style={{ color: "var(--chart-series-3)" }}>
                  {aggregateMetrics.qual}%
                </div>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        {/* Status Count Summary */}
        <Row className="mb-4 gap-3 text-center">
          <Col className="col-span-6 sm:col-span-3">
            <Card className="rounded-lg border-b-4 border-b-[color:var(--color-success)]">
              <Card.Body>
                <div className="text-ink-muted font-bold uppercase" style={{ fontSize: "12px" }}>
                  Running
                </div>
                <h3 className="mb-0 text-[color:var(--color-success)]">
                  {aggregateMetrics.running}
                </h3>
              </Card.Body>
            </Card>
          </Col>
          <Col className="col-span-6 sm:col-span-3">
            <Card className="rounded-lg border-b-4 border-b-line">
              <Card.Body>
                <div className="text-ink-muted font-bold uppercase" style={{ fontSize: "12px" }}>
                  Idle
                </div>
                <h3 className="mb-0 text-ink-muted">{aggregateMetrics.idle}</h3>
              </Card.Body>
            </Card>
          </Col>
          <Col className="col-span-6 sm:col-span-3">
            <Card className="rounded-lg border-b-4 border-b-[color:var(--color-danger)]">
              <Card.Body>
                <div className="text-ink-muted font-bold uppercase" style={{ fontSize: "12px" }}>
                  Breakdown
                </div>
                <h3 className="mb-0 text-[color:var(--color-danger)]">
                  {aggregateMetrics.breakdown}
                </h3>
              </Card.Body>
            </Card>
          </Col>
          <Col className="col-span-6 sm:col-span-3">
            <Card className="rounded-lg border-b-4 border-b-[color:var(--color-info)]">
              <Card.Body>
                <div className="text-ink-muted font-bold uppercase" style={{ fontSize: "12px" }}>
                  Waiting / Setup
                </div>
                <h3 className="mb-0 text-[color:var(--color-info)]">{aggregateMetrics.waiting}</h3>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Individual Machine Cards */}
        <h5 className="font-bold mb-3 mt-2 text-ink">
          <FaIndustry className="mr-2 text-accent" /> Machine Activities
        </h5>
        <Row>
          {machines.map((machine) => {
            const tokens = getStatusTokens(machine.machineStatus);
            return (
              <Col className="col-span-12 sm:col-span-6 lg:col-span-4" key={machine.machineId}>
                <Card className="rounded-lg h-full overflow-hidden">
                  <div
                    className={`${tokens.bg} px-4 py-3 flex justify-between items-center border-b ${tokens.border}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`${tokens.text} text-xl`}>
                        {getStatusIcon(machine.machineStatus)}
                      </div>
                      <h6 className="mb-0 font-bold text-ink">{machine.machineName}</h6>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${tokens.border} ${tokens.text} ${tokens.bg}`}
                    >
                      {machine.machineStatus}
                    </span>
                  </div>
                  <Card.Body className="p-4">
                    {/* Primary Metric */}
                    <div className="text-center mb-4 pb-3 border-b border-dashed border-line">
                      <div
                        className="text-ink-muted uppercase font-bold"
                        style={{ fontSize: "11px", letterSpacing: "1px" }}
                      >
                        Current OEE
                      </div>
                      <div
                        style={{
                          fontSize: "3rem",
                          fontWeight: "800",
                          lineHeight: 1,
                          color:
                            machine.currentOee === null
                              ? "var(--color-ink-subtle)"
                              : machine.currentOee >= 85
                                ? "var(--color-success)"
                                : machine.currentOee >= 60
                                  ? "var(--color-warning)"
                                  : "var(--color-danger)",
                        }}
                      >
                        {machine.currentOee !== null ? `${machine.currentOee}%` : "—"}
                      </div>
                    </div>

                    {/* Sub Metrics */}
                    <Row className="text-center gap-2 mb-4">
                      <Col className="col-span-4">
                        <div
                          className="text-ink-muted"
                          style={{ fontSize: "10px", textTransform: "uppercase" }}
                        >
                          Avail
                        </div>
                        <div className="font-bold" style={{ color: "var(--chart-series-1)" }}>
                          {machine.availability !== null ? `${machine.availability}%` : "-"}
                        </div>
                      </Col>
                      <Col className="col-span-4 border-l border-line">
                        <div
                          className="text-ink-muted"
                          style={{ fontSize: "10px", textTransform: "uppercase" }}
                        >
                          Perf
                        </div>
                        <div className="font-bold" style={{ color: "var(--chart-series-2)" }}>
                          {machine.performance !== null ? `${machine.performance}%` : "-"}
                        </div>
                      </Col>
                      <Col className="col-span-4 border-l border-line">
                        <div
                          className="text-ink-muted"
                          style={{ fontSize: "10px", textTransform: "uppercase" }}
                        >
                          Qual
                        </div>
                        <div className="font-bold" style={{ color: "var(--chart-series-3)" }}>
                          {machine.quality !== null ? `${machine.quality}%` : "-"}
                        </div>
                      </Col>
                    </Row>

                    {/* Additional Details */}
                    <div className="bg-card-2 p-3 rounded-lg" style={{ fontSize: "13px" }}>
                      <div className="flex justify-between mb-2">
                        <span className="text-ink-muted">Operator:</span>
                        <span className="font-bold text-ink">
                          {machine.operatorId || "Unassigned"}
                        </span>
                      </div>
                      <div className="flex justify-between mb-2">
                        <span className="text-ink-muted">Active Plan:</span>
                        <span
                          className="font-bold text-ink text-right"
                          style={{ maxWidth: "150px" }}
                          title={machine.activeProductionOrderId || "None"}
                        >
                          {machine.activeProductionOrderId || "None"}
                        </span>
                      </div>
                      <div className="flex justify-between mb-2">
                        <span className="text-ink-muted">Planned Run:</span>
                        <span className="font-bold text-ink">
                          {machine.todayPlannedHours ? `${machine.todayPlannedHours} hrs` : "0 hrs"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-muted">Cycle Time:</span>
                        <span className="font-bold text-ink">
                          {machine.cycleTime ? `${machine.cycleTime}s` : "-"}
                        </span>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Container>
    </div>
  );
};

export default OeeDashboard;
