import React from "react";
import { FaCloudUploadAlt, FaCheckCircle } from "react-icons/fa";
import "./ImageUpload.css";

interface ImageUploadProps {
  label?: string;
  name: string;
  currentImageUrl?: string;
  hint?: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Round dashed image picker with a preview and a label/hint beside it. */
const ImageUpload: React.FC<ImageUploadProps> = ({
  label,
  name,
  currentImageUrl,
  hint,
  onChange,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (currentImageUrl && !fileName) {
      setPreviewUrl(currentImageUrl);
    }
  }, [currentImageUrl, fileName]);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setFileName(null);
      setPreviewUrl(currentImageUrl || null);
    }
    onChange(e);
  };

  return (
    <div
      className="image-upload-wrapper"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={label ? `Upload ${label}` : "Upload image"}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <input
        type="file"
        name={name}
        accept="image/*"
        onChange={handleFileChange}
        ref={fileInputRef}
        style={{ display: "none" }}
        tabIndex={-1}
      />
      <div className="image-upload-box">
        {previewUrl ? (
          <div className="relative w-full h-full flex justify-center items-center overflow-hidden rounded-full group">
            <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center rounded-full bg-[color:var(--sl-scrim)] text-white opacity-0 transition-opacity group-hover:opacity-100">
              <FaCloudUploadAlt className="text-xl" />
              <span className="text-[10px] font-medium">Change</span>
            </div>
          </div>
        ) : fileName ? (
          <div className="image-upload-placeholder text-[color:var(--color-success)]">
            <FaCheckCircle className="image-upload-icon !text-[color:var(--color-success)]" />
          </div>
        ) : (
          <div className="image-upload-placeholder">
            <FaCloudUploadAlt className="image-upload-icon" />
          </div>
        )}
      </div>
      <div className="image-upload-info">
        {label && <span className="image-upload-label">{label}</span>}
        {hint && <span className="image-upload-hint">{hint}</span>}
      </div>
    </div>
  );
};

export default ImageUpload;
