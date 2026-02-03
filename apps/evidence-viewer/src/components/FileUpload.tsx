import { useCallback, useRef } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File, verifyPath?: string) => void;
  isLoading: boolean;
}

export default function FileUpload({ onFileSelect, isLoading }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file?.name.endsWith('.zip')) {
        onFileSelect(file);
      }
      e.target.value = '';
    },
    [onFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (isLoading) return;
      const file = e.dataTransfer.files[0];
      if (file?.name.endsWith('.zip')) {
        onFileSelect(file);
      }
    },
    [onFileSelect, isLoading]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div
      className="file-upload-zone"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        onChange={handleChange}
        style={{ display: 'none' }}
        disabled={isLoading}
      />
      <span>Drag Auditor Pack ZIP here, or click to browse</span>
    </div>
  );
}
