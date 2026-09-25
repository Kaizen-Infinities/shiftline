import React, { useState, useEffect } from "react";
import { Play } from "lucide-react";
import { Modal, Form, Row, Col, Button } from "../TailwindPrimitives";
import { shiftService } from "../../../services/shiftService";
import type { Shift } from "../../../features/shifts/types";

interface Machine {
  machineId: string;
  machineName: string;
}

interface StartProductionModalProps {
  show: boolean;
  onHide: () => void;
  onConfirm: (machineId: string, shiftId: string) => void;
  program: any;
  allowedMachines: Machine[];
}

const StartProductionModal: React.FC<StartProductionModalProps> = ({
  show,
  onHide,
  onConfirm,
  program,
  allowedMachines,
}) => {
  const [machineId, setMachineId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [shifts, setShifts] = useState<Shift[]>([]);

  // Fetch shifts once on mount
  useEffect(() => {
    const loadShifts = async () => {
      try {
        const data = await shiftService.fetchAll();
        setShifts(data);
      } catch (err) {
        console.error("Failed to load shifts:", err);
      }
    };
    loadShifts();
  }, []);

  // Reset selections whenever modal opens
  useEffect(() => {
    if (show) {
      setMachineId("");
      setShiftId("");
    }
  }, [show]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(machineId, shiftId);
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <div className="flex items-center gap-3">
          <span
            className="sl-dialog-icon sl-dialog-icon-success h-10 w-10 rounded-[14px]"
            aria-hidden="true"
          >
            <Play size={18} />
          </span>
          <Modal.Title>Start Production Run</Modal.Title>
        </div>
      </Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          <Row>
            <Col md={12}>
              <Form.Group>
                <Form.Label>Run Details</Form.Label>
                <div className="rounded-[14px] border border-line-soft bg-card-2 p-3.5 text-sm leading-relaxed text-ink">
                  <strong>PO ID:</strong> {program?.productionOrderId}
                  <br />
                  <strong>Product Name:</strong>{" "}
                  {program?.productionOrder?.productItem?.productName}
                  <br />
                  <strong>Target Quantity:</strong> {program?.plannedQty} pcs
                </div>
              </Form.Group>
            </Col>

            <Col md={6} className="md:col-span-6">
              <Form.Group>
                <Form.Label htmlFor="start-run-machine">Select Machine to Run On</Form.Label>
                <Form.Select
                  id="start-run-machine"
                  required
                  value={machineId}
                  onChange={(e) => setMachineId(e.target.value)}
                >
                  <option value="">-- Choose Active Machine --</option>
                  {allowedMachines.map((m) => (
                    <option key={m.machineId} value={m.machineId}>
                      {m.machineName} ({m.machineId})
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="mt-1 font-medium text-[color:var(--color-danger)]">
                  * MAC-001 disabled for planning
                </Form.Text>
              </Form.Group>
            </Col>

            <Col md={6} className="md:col-span-6">
              <Form.Group>
                <Form.Label htmlFor="start-run-shift">Select Shift</Form.Label>
                <Form.Select
                  id="start-run-shift"
                  required
                  value={shiftId}
                  onChange={(e) => setShiftId(e.target.value)}
                >
                  <option value="">-- Choose Shift --</option>
                  {shifts.map((s) => (
                    <option key={s.shiftCode} value={s.shiftCode}>
                      {s.shiftName} ({s.startTime} - {s.endTime})
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide}>
            Cancel
          </Button>
          <Button type="submit" variant="success">
            Confirm Start Run
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default StartProductionModal;
