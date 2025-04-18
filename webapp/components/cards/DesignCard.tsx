'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImageIcon, Loader2 } from 'lucide-react';
import { DesignGridItem, DesignStage } from '@/types/models';
import { useAuth } from '@/providers/AuthProvider';
import Image from 'next/image';

interface DesignCardProps {
  design: DesignGridItem;
  onClick: () => void;
}

export const DesignCard = ({ design, onClick }: DesignCardProps) => {
  const { supabase } = useAuth();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);

  useEffect(() => {
    if (supabase && design.latest_thumbnail_path) {
      setIsLoadingUrl(true);
      const path = design.latest_thumbnail_path; // Assign to new variable
      const getSignedUrl = async () => {
        try {
          // Extra check to satisfy TypeScript
          if (!path) throw new Error("Thumbnail path is unexpectedly null or undefined."); 
          
          const { data, error } = await supabase.storage
            .from('design-variations')
            .createSignedUrl(path, 300); // Use the checked path variable
          
          if (error) {
            throw error;
          }

          console.log(`[DesignCard] Path: ${path}, Signed URL: ${data?.signedUrl}`);
          setImageUrl(data?.signedUrl || null);
        } catch (error: any) {
          console.error("Error getting signed URL:", error.message || error);
          setImageUrl(null);
        }
        setIsLoadingUrl(false);
      };
      getSignedUrl();
    } else {
      setImageUrl(null);
    }
  }, [supabase, design.latest_thumbnail_path]);

  return (
    <Card
      className="cursor-pointer hover:shadow-lg transition-shadow duration-200 overflow-hidden group"
      onClick={onClick}
    >
      <CardContent className="p-0 aspect-square flex items-center justify-center bg-muted relative overflow-hidden">
        {isLoadingUrl ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : imageUrl ? (
          <Image
            src={imageUrl}
            alt={`Thumbnail for ${design.name}`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            style={{ objectFit: 'cover' }}
            className="transition-transform duration-300 group-hover:scale-105"
            unoptimized
            onError={(e) => {
              console.error(`[DesignCard] Failed to load image: ${imageUrl}`, e);
              setImageUrl(null);
            }}
          />
        ) : (
          <ImageIcon className="h-12 w-12 text-muted-foreground" />
        )}
      </CardContent>
      <CardFooter className="p-3 flex justify-between items-center bg-background border-t">
        <span className="font-medium text-sm truncate" title={design.name}>{design.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="secondary" className="text-xs capitalize">{design.latest_version_stage || 'N/A'}</Badge>
          <Badge variant="outline" className="text-xs">{design.status}</Badge>
        </div>
      </CardFooter>
    </Card>
  );
}; 