import React from "react";
import { Upload } from "lucide-react";
import { RequiredMark, fieldLabelClass } from "../fieldStyles";

interface FileUploadProps {
  label: string;
  name: string;
  id?: string;
  required?: boolean;
  previewUrl?: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/** File picker in the `.sl-input` style (pill "Choose file" button); shows an image preview once set. */
const FileUpload: React.FC<FileUploadProps> = ({
  label,
  name,
  id,
  required = false,
  previewUrl,
  onChange,
}) => {
  const inputId = id || name;
  return (
    <div className="flex w-full min-w-0 flex-col">
      <label htmlFor={inputId} className={fieldLabelClass()}>
        <span>{label}</span>
        {required && <RequiredMark />}
      </label>

      <div className="flex w-full items-center gap-3">
        <input
          type="file"
          id={inputId}
          name={name}
          onChange={onChange}
          aria-required={required || undefined}
          className={`sl-input block h-11 w-full flex-1 cursor-pointer py-1.5 pl-1.5 text-sm text-ink-muted
            file:mr-3 file:h-full file:cursor-pointer file:rounded-full file:border-0 file:bg-chip file:px-4
            file:text-[13px] file:font-semibold file:text-[color:var(--color-chip-fg)]
            hover:file:brightness-95
            ${previewUrl ? "hidden" : ""}
          `}
        />

        {previewUrl && (
          <label
            htmlFor={inputId}
            className="group relative flex h-[64px] min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-[14px] border border-line bg-card-2 p-1 transition-colors hover:border-[color:var(--color-primary)]"
            title="Click to change image"
          >
            <img
              src={previewUrl}
              alt={`${label} Preview`}
              className="h-full w-auto rounded-[10px] object-contain"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--sl-scrim)] opacity-0 transition-opacity group-hover:opacity-100">
              <Upload className="text-white" size={18} aria-hidden="true" />
            </div>
            <span className="sr-only">Change {label}</span>
          </label>
        )}
      </div>
    </div>
  );
};

export default FileUpload;
