'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useAuth } from '@/providers/AuthProvider';
import { Loader2, ImageOff } from 'lucide-react';

interface ModalImageViewerProps {
  filePath: string | null | undefined;
}

const BUCKET_NAME = 'design-variations'; // Define bucket name centrally
const URL_EXPIRY_SECONDS = 300; // 5 minutes

export const ModalImageViewer = ({ filePath }: ModalImageViewerProps) => {
  const { supabase } = useAuth();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset state when filePath changes
    setImageUrl(null);
    setError(null);
    setIsLoading(false);

    if (supabase && filePath) {
      setIsLoading(true);
      let isMounted = true; // Prevent state update on unmounted component

      const getSignedUrl = async () => {
        try {
          const { data, error: signedUrlError } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(filePath, URL_EXPIRY_SECONDS);

          if (!isMounted) return; // Don't update if component unmounted

          if (signedUrlError) {
            throw signedUrlError;
          }

          setImageUrl(data?.signedUrl || null);
          setError(null);
        } catch (err: any) {
          console.error("Error getting signed URL for modal image:", err.message || err);
          setError("Could not load image preview.");
          setImageUrl(null);
        }
        setIsLoading(false);
      };

      getSignedUrl();

      // Cleanup function to set isMounted to false when component unmounts
      return () => {
        isMounted = false;
      };

    } else if (!filePath) {
        // Handle case where there is explicitly no file path
        setError("No image available for this variation.");
    }
  }, [supabase, filePath]); // Re-run when supabase client or filePath changes

  return (
    <div className="relative aspect-video w-full bg-muted rounded flex items-center justify-center overflow-hidden min-h-[300px]"> 
      {isLoading ? (
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      ) : error ? (
        <div className="text-center text-muted-foreground p-4">
          <ImageOff className="h-10 w-10 mx-auto mb-2" />
          <p>{error}</p>
        </div>
      ) : imageUrl ? (
        <Image
          src={imageUrl}
          alt={filePath ? `Preview for ${filePath.split('/').pop()}` : 'Image Preview'}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw" // Adjust sizes based on modal width
          style={{ objectFit: 'contain' }} // Use 'contain' to see the whole image
          priority
          onError={() => setError("Failed to load image.")}
        />
      ) : (
         // This state should ideally be covered by isLoading or error
         <div className="text-center text-muted-foreground p-4">
            <ImageOff className="h-10 w-10 mx-auto mb-2" />
            <p>Image not available.</p>
          </div>
      )}
    </div>
  );
}; 