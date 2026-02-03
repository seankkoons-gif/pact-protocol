import { useCallback, useRef } from 'react';

const ACCEPT_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.txt', '.json'];
const ACCEPT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'application/json',
];

function isAccepted(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
  return ACCEPT_EXT.includes(ext) || ACCEPT_TYPES.includes(file.type);
}

export interface AttachmentEntry {
  file: File;
  addedAt: number;
}

interface AttachmentsDropZoneProps {
  attachments: AttachmentEntry[];
  onAttachmentsChange: (attachments: AttachmentEntry[]) => void;
}

export default function AttachmentsDropZone({
  attachments,
  onAttachmentsChange,
}: AttachmentsDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const toAdd: AttachmentEntry[] = [];
      const now = Date.now();
      const arr = Array.from(files);
      for (const file of arr) {
        if (isAccepted(file)) {
          toAdd.push({ file, addedAt: now });
        }
      }
      if (toAdd.length > 0) {
        onAttachmentsChange([...attachments, ...toAdd]);
      }
    },
    [attachments, onAttachmentsChange]
  );

  const removeAt = useCallback(
    (index: number) => {
      onAttachmentsChange(attachments.filter((_, i) => i !== index));
    },
    [attachments, onAttachmentsChange]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files?.length) {
        addFiles(files);
      }
      e.target.value = '';
    },
    [addFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer.files;
      if (files?.length) addFiles(files);
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className="attachments-drop-zone">
      <h4 className="attachments-title">Drop in documents</h4>
      <p className="attachments-hint">Attach supporting documents (PDF, images, text) to include in the Claims Intake Package.</p>
      <div
        className="attachments-drop-area"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt,.json,application/pdf,image/png,image/jpeg,text/plain,application/json"
          multiple
          onChange={handleChange}
          style={{ display: 'none' }}
        />
        <span>Attach supporting documents</span>
      </div>
      {attachments.length > 0 && (
        <ul className="attachments-list">
          {attachments.map((a, i) => (
            <li key={`${a.file.name}-${a.addedAt}-${i}`} className="attachment-item">
              <span className="attachment-name">{a.file.name}</span>
              <span className="attachment-size">({(a.file.size / 1024).toFixed(1)} KB)</span>
              <button
                type="button"
                className="attachment-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
                title="Remove"
                aria-label={`Remove ${a.file.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
