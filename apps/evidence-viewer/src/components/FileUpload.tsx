import { useCallback, useRef } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File, verifyPath?: string) => void;
  onError?: (message: string) => void;
  isLoading: boolean;
}

const ZIP_TYPES = ['application/zip', 'application/x-zip-compressed'];

function isZipFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith('.zip') ||
    ZIP_TYPES.includes(file.type)
  );
}

export default function FileUpload({ onFileSelect, onError, isLoading }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const trySelect = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (isZipFile(file)) {
        onError?.('');
        onFileSelect(file);
      } else {
        onError?.('Please select a .zip file. This viewer only accepts Pact auditor pack ZIPs.');
      }
    },
    [onFileSelect, onError]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      trySelect(file);
      e.target.value = '';
    },
    [trySelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isLoading) return;
      const file = e.dataTransfer.files?.[0];
      trySelect(file);
    },
    [trySelect, isLoading]
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
        accept=".zip,application/zip,application/x-zip-compressed"
        onChange={handleChange}
        style={{ display: 'none' }}
        disabled={isLoading}
      />
      <span>Drag Auditor Pack ZIP here, or click to browse</span>
    </div>
  );
}
