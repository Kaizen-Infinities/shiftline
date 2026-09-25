import React, { useState } from "react";
import { FaPlus } from "react-icons/fa";
import { toast } from "react-toastify";
import TextInput from "../../form/TextInput/TextInput";
import DeleteButton from "../DeleteButton/DeleteButton";

export interface ProductionWorkflowInputProps {
  /** Ordered list of step names. Empty = no workflow. */
  value: string[];
  /** Called with the updated ordered list whenever steps are added/removed. */
  onChange: (steps: string[]) => void;
  /** Optional error message to show below the list (e.g. duplicate step). */
  error?: string;
  /** Optional heading override. */
  label?: string;
  /** Optional helper text override. */
  helperText?: string;
}

/**
 * Reusable, free-text, step-by-step workflow builder.
 *
 * Fully controlled: the parent owns `value` (an ordered string[]) and
 * receives updates via `onChange`. No hardcoded stages — the user types
 * whatever step names they want (e.g. Production, Handle Change,
 * Stickering & Package, Dispatch, or anything custom), and the order they
 * add them in is the order the item moves through the pipeline.
 *
 * Usage:
 *   const [steps, setSteps] = useState<string[]>([]);
 *   <ProductionWorkflowInput value={steps} onChange={setSteps} error={errors.productionSteps} />
 */
const FlowInput: React.FC<ProductionWorkflowInputProps> = ({
  value,
  onChange,
  error,
  label = "Production Workflow",
}) => {
  const [stepInput, setStepInput] = useState("");

  const handleAddStep = () => {
    const trimmed = stepInput.trim();
    if (!trimmed) {
      toast.error("Type a step name first");
      return;
    }
    const alreadyExists = value.some((s) => s.trim().toLowerCase() === trimmed.toLowerCase());
    if (alreadyExists) {
      toast.error("That step has already been added");
      return;
    }
    onChange([...value, trimmed]);
    setStepInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddStep();
    }
  };

  const handleRemoveStep = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div>
      <h6 className="sl-h2 m-0 mb-2 !text-base">{label}</h6>

      {/* Text box + Add button */}
      <div className="mb-3 flex items-start gap-2 [&_.sl-pill-md]:mt-0">
        <div className="flex-1">
          <TextInput
            label=""
            name="productionWorkflowStepInput"
            value={stepInput}
            placeholder="e.g. Production"
            onChange={(e) => setStepInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <button type="button" onClick={handleAddStep} className="sl-btn sl-pill-md shrink-0">
          <FaPlus size={11} aria-hidden="true" /> Add Step
        </button>
      </div>

      {value.length > 0 ? (
        <div className="rounded-[18px] border border-line-soft bg-card-2 p-3 sm:p-4">
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {value.map((step, idx) => (
              <li key={idx} className="flex items-center gap-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white"
                  aria-hidden="true"
                >
                  {idx + 1}
                </span>
                <span className="flex-1 rounded-[12px] border border-line-soft bg-card px-3.5 py-2.5 text-sm font-medium text-ink">
                  {step}
                </span>
                <div className="shrink-0 flex items-center">
                  <DeleteButton onClick={() => handleRemoveStep(idx)} />
                </div>
              </li>
            ))}
          </ol>
          {error && (
            <div
              role="alert"
              className="sl-field-error mt-3 rounded-[12px] border border-[color:var(--color-danger)]/25 bg-[color:var(--color-danger)]/10 px-3 py-2"
            >
              {error}
            </div>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default FlowInput;
