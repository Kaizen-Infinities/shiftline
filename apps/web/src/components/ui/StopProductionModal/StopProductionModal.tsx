import React, { useState, useEffect } from "react";
import { Square } from "lucide-react";
import { Modal, Form, Button } from "../TailwindPrimitives";
import TextInput from "../../form/TextInput/TextInput";

interface StopProductionModalProps {
  show: boolean;
  onHide: () => void;
  onConfirm: (reason: string, remarks: string) => void;
  program: any;
}

const StopProductionModal: React.FC<StopProductionModalProps> = ({
  show,
  onHide,
  onConfirm,
  program,
}) => {
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");

  const stopReasons = [
    "Machine Breakdown",
    "Power Failure",
    "Material Shortage",
    "Tool Change",
    "Lunch/Tea Break",
    "Maintenance",
    "Shift End",
    "Production Complete",
    "Others",
  ];

  useEffect(() => {
    if (show) {
      setReason("");
      setRemarks("");
    }
  }, [show]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(reason, remarks);
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <div className="flex items-center gap-3">
          <span
            className="sl-dialog-icon sl-dialog-icon-danger h-10 w-10 rounded-[14px]"
            aria-hidden="true"
          >
            <Square size={16} />
          </span>
          <Modal.Title>Stop Production Run</Modal.Title>
        </div>
      </Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          <div className="mb-4 rounded-[14px] border border-line-soft bg-card-2 p-3.5 text-sm leading-relaxed text-ink">
            <strong>PO ID:</strong> {program?.productionOrderId}
            <br />
            <strong>Product Name:</strong> {program?.productionOrder?.productItem?.productName}
            <br />
          </div>

          <Form.Group className="mb-4">
            <Form.Label htmlFor="stop-run-reason">Stop Reason</Form.Label>
            <Form.Select
              id="stop-run-reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">-- Select Reason --</option>
              {stopReasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          {reason === "Others" && (
            <Form.Group className="mb-2">
              <Form.Label htmlFor="remarks">Remarks</Form.Label>
              <TextInput
                name="remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Enter remarks for stopping..."
                required
              />
            </Form.Group>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide}>
            Cancel
          </Button>
          <Button type="submit" variant="danger">
            Confirm Stop Run
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default StopProductionModal;
