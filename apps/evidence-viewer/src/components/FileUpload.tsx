import { useRef, useState } from 'react';
import './FileUpload.css';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
}

export default function FileUpload({ onFileSelect, isLoading }: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = (file: File) => {
    if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
      onFileSelect(file);
    } else {
      alert('Please select a ZIP file');
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  return (
    <div className="file-upload-container">
      <div
        className={`file-upload-area ${isDragging ? 'dragging' : ''} ${isLoading ? 'loading' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
        {isLoading ? (
          <div className="upload-content">
            <div className="upload-spinner"></div>
            <p>Loading auditor pack...</p>
          </div>
        ) : (
          <div className="upload-content">
            <div className="upload-icon">📦</div>
            <p className="upload-text">
              <strong>Drop an Auditor Pack ZIP file here</strong>
            </p>
            <p className="upload-subtext">or click to browse</p>
          </div>
        )}
      </div>
    </div>
  );
}
