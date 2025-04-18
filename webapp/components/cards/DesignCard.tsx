'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImageIcon, Loader2 } from 'lucide-react';
import { DesignGridItem, DesignStage, VariationFeedbackStatus } from '@/types/models';
import { useAuth } from '@/providers/AuthProvider';
import Image from 'next/image';
import { cn } from '@/lib/utils';

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

  // Determine color/variant for the priority status badge
  const getStatusBadgeClass = (status: VariationFeedbackStatus | null) => {
    switch (status) {
      case VariationFeedbackStatus.NeedsChanges:
        return "bg-orange-100 text-orange-800 border-orange-200"; // Orange
      case VariationFeedbackStatus.PendingFeedback:
        return "bg-gray-100 text-gray-800 border-gray-200"; // Gray
      case VariationFeedbackStatus.Approved:
        return "bg-green-100 text-green-800 border-green-200"; // Green
      case VariationFeedbackStatus.Rejected:
        return "bg-red-100 text-red-800 border-red-200"; // Red
      default:
        return "bg-muted text-muted-foreground border-transparent"; // Default/Null
    }
  };

  return (
    <Card
      className="p-0 gap-0 cursor-pointer hover:shadow-lg transition-shadow duration-200 overflow-hidden group"
      onClick={onClick}
    >
      <CardContent className="p-0 aspect-square bg-muted relative overflow-hidden mb-0">
        {isLoadingUrl ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : imageUrl ? (
          <Image
            src={imageUrl}
            alt={`Thumbnail for ${design.name}`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            style={{ objectFit: 'cover' }}
            className="absolute w-full h-full transition-transform duration-300 group-hover:scale-105"
            onError={(e) => {
              console.error(`[DesignCard] Failed to load image: ${imageUrl}`, e);
              setImageUrl(null);
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full w-full">
            <ImageIcon className="h-12 w-12 text-muted-foreground" />
          </div>
        )}
      </CardContent>
      {/* Footer with vertical stacking */}
      <CardFooter className="p-3 flex flex-col items-start bg-background border-t mt-0 mb-0">
        <span className="font-medium text-sm truncate w-full" title={design.name}>{design.name}</span>
        {/* Container for badges below name */}
        <div className="flex items-center gap-1.5 mt-1">
          {/* Priority Variation Status Badge */}
          {design.latest_priority_variation_status && (
            <Badge 
              className={cn("text-xs border", getStatusBadgeClass(design.latest_priority_variation_status))}
              title={`Feedback: ${design.latest_priority_variation_status}`}
            >
              {design.latest_priority_variation_status} 
            </Badge>
          )}
          {/* Latest Version Stage Badge */}
          <Badge variant="secondary" className="text-xs capitalize">{design.latest_version_stage || 'N/A'}</Badge>
          {/* REMOVED design.status badge */}
        </div>
      </CardFooter>
    </Card>
  );
};
