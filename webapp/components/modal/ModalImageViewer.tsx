'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useAuth } from '@/providers/AuthProvider';
import { Loader2, ImageOff } from 'lucide-react';
import { getProcessedImagePath, getPublicImageUrl } from '@/lib/imageUtils';
import { LARGE_WIDTH } from '@/lib/constants/imageConstants';

interface ModalImageViewerProps {
  filePath: string | null | undefined;
}

export const ModalImageViewer = ({ filePath }: ModalImageViewerProps) => {
  const { supabase } = useAuth();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const safeSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const processedBucketName = process.env.NEXT_PUBLIC_SUPABASE_PROCESSED_BUCKET;

  useEffect(() => {
    // Reset state
    setImageUrl(null);
    setError(null);
    setIsLoading(true);

    if (!supabaseUrl || !processedBucketName) {
        setError("Image configuration error.");
        console.error("Error: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PROCESSED_BUCKET is not set.");
        setIsLoading(false);
        return;
    }

    if (filePath) {
      try {
        // 1. Generate the path for the large processed image
        const processedPath = getProcessedImagePath(filePath, LARGE_WIDTH);

        // 2. Construct the public URL
        const publicUrl = getPublicImageUrl(supabaseUrl, processedBucketName, processedPath);

        setImageUrl(publicUrl);
        setError(null);
      } catch (err: unknown) {
        console.error("Error generating processed image URL:", err);
        setError("Could not generate image URL.");
        setImageUrl(null);
      }
      setIsLoading(false);
    } else {
      setError("No image available for this variation.");
      setIsLoading(false);
    }
  }, [filePath, supabaseUrl, processedBucketName]);

  return (
    <div className="relative w-full h-full flex items-center justify-center min-h-[300px]"> 
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
          style={{ objectFit: 'contain' }}
          priority
          className="rounded-lg"
          unoptimized={!((imageUrl ?? "").includes(safeSupabaseUrl))}
          onError={() => {
            console.error(`Failed to load large image: ${imageUrl}`);
            setError("Failed to load image.");
            setImageUrl(null);
          }}
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