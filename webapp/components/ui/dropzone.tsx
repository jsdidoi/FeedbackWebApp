'use client';

import React, { useCallback } from 'react';
import { useDropzone, FileRejection, DropzoneOptions } from 'react-dropzone';
import { cn } from '@/lib/utils'; // Assuming you have a cn utility for class names
import { UploadCloud, XCircle, File as FileIcon } from 'lucide-react'; // Icons for visual feedback

interface DropzoneProps extends DropzoneOptions {
  className?: string;
  onFilesAccepted: (acceptedFiles: File[]) => void;
  onFilesRejected?: (fileRejections: FileRejection[]) => void; // Optional: Handle rejected files
}

const Dropzone: React.FC<DropzoneProps> = ({
  className,
  onFilesAccepted,
  onFilesRejected,
  ...dropzoneOptions // Pass other react-dropzone options (accept, maxSize, etc.)
}) => {
  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      onFilesAccepted(acceptedFiles);
      if (onFilesRejected && fileRejections.length > 0) {
        onFilesRejected(fileRejections);
      }
    },
    [onFilesAccepted, onFilesRejected]
  );

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject,
    acceptedFiles, // Keep track of accepted files for display (optional)
  } = useDropzone({
    onDrop,
    ...dropzoneOptions,
  });

  // Basic styling - enhance as needed
  const baseStyle = "flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-200 ease-in-out";
  const activeStyle = "border-primary";
  const acceptStyle = "border-green-500 bg-green-500/10";
  const rejectStyle = "border-red-500 bg-red-500/10";

  const style = cn(
    baseStyle,
    isDragActive && activeStyle,
    isDragAccept && acceptStyle,
    isDragReject && rejectStyle,
    className
  );

  return (
    <div {...getRootProps({ className: style })}>
      <input {...getInputProps()} />
      <div className="text-center">
        <UploadCloud className={`mx-auto h-12 w-12 ${isDragReject ? 'text-red-500' : isDragAccept ? 'text-green-500' : 'text-muted-foreground'}`} />
        {isDragReject ? (
          <p className="mt-2 text-sm font-semibold text-red-500">Files will be rejected</p>
        ) : isDragAccept ? (
          <p className="mt-2 text-sm font-semibold text-green-500">Drop files here</p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-semibold">Click to upload</span> or drag and drop
          </p>
        )}
        {/* Display basic accepted file names (optional) */}
        {acceptedFiles.length > 0 && (
          <div className="mt-4 text-xs text-muted-foreground">
            {acceptedFiles.map(file => (
              <div key={file.name} className="flex items-center space-x-1">
                 <FileIcon className="h-3 w-3 flex-shrink-0" />
                 <span>{file.name}</span>
              </div>
            ))}
           </div>
        )}
        {/* TODO: Add file type/size constraints display if needed */}
      </div>
    </div>
  );
};

export default Dropzone; 