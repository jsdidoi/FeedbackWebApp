'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImageIcon, Loader2, Pencil, Trash2 } from 'lucide-react';
import { DesignGridItem, DesignStage, VariationFeedbackStatus } from '@/types/models';
import { useAuth } from '@/providers/AuthProvider';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

interface DesignCardProps {
  design: DesignGridItem;
  onClick: () => void;
  onSaveName: (designId: string, newName: string) => void;
  onDelete: (designId: string) => void;
}

export const DesignCard = ({ design, onClick, onSaveName, onDelete }: DesignCardProps) => {
  const { supabase } = useAuth();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [editedName, setEditedName] = useState(design.name);
  const [isEditNameDialogOpen, setIsEditNameDialogOpen] = useState(false);

  useEffect(() => {
    if (supabase && design.latest_thumbnail_path) {
      setIsLoadingUrl(true);
      const path = design.latest_thumbnail_path;
      const getSignedUrl = async () => {
        try {
          if (!path) throw new Error("Thumbnail path is unexpectedly null or undefined."); 
          
          const { data, error } = await supabase.storage
            .from('design-variations')
            .createSignedUrl(path, 300);
          
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

  useEffect(() => {
    setEditedName(design.name);
  }, [design.name]);

  const getStatusBadgeClass = (status: VariationFeedbackStatus | null) => {
    switch (status) {
      case VariationFeedbackStatus.NeedsChanges:
        return "bg-orange-100 text-orange-800 border-orange-200";
      case VariationFeedbackStatus.PendingFeedback:
        return "bg-gray-100 text-gray-800 border-gray-200";
      case VariationFeedbackStatus.Approved:
        return "bg-green-100 text-green-800 border-green-200";
      case VariationFeedbackStatus.Rejected:
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-muted text-muted-foreground border-transparent";
    }
  };

  const handleSaveClick = () => {
    if (editedName.trim() && editedName.trim() !== design.name) {
      onSaveName(design.id, editedName.trim());
      setIsEditNameDialogOpen(false);
    } else if (!editedName.trim()) {
      alert("Design name cannot be empty."); 
    } else {
      setIsEditNameDialogOpen(false);
    }
  };

  return (
    <Card
      className="p-0 gap-0 cursor-pointer hover:shadow-lg transition-shadow duration-200 overflow-hidden group relative"
      onClick={onClick}
    >
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-1 right-1 z-10 h-6 w-6 opacity-0 group-hover:opacity-80 hover:!opacity-100 transition-opacity bg-destructive/70 hover:bg-destructive/90 p-1"
            onClick={(e) => e.stopPropagation()}
            title="Delete Design"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent onClick={(e: React.MouseEvent) => e.stopPropagation()} >
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the design
              "{design.name}" and all its associated versions, variations, comments, and files.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => onDelete(design.id)} 
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      <CardFooter className="p-3 flex flex-col items-start bg-background border-t mt-0 mb-0">
        <div className="flex justify-between items-center w-full mb-1"> 
          <span className="font-medium text-sm truncate" title={design.name}>{design.name}</span>
          <Dialog open={isEditNameDialogOpen} onOpenChange={setIsEditNameDialogOpen}>
            <DialogTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-5 w-5 shrink-0 opacity-50 hover:opacity-100" 
                onClick={(e) => { e.stopPropagation(); setEditedName(design.name); }} 
                title="Edit Design Name"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </DialogTrigger>
            <DialogContent 
              className="sm:max-w-[425px]" 
              onPointerDownOutside={(e) => e.preventDefault()} 
              onClick={(e) => e.stopPropagation()}
            >
              <DialogHeader>
                <DialogTitle>Edit Design Name</DialogTitle>
                <DialogDescription>
                  Enter a new name for the design "{design.name}".
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">
                    Name
                  </Label>
                  <Input 
                    id="name" 
                    value={editedName} 
                    onChange={(e) => setEditedName(e.target.value)}
                    className="col-span-3" 
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveClick(); }}
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" onClick={(e) => e.stopPropagation()}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="button" onClick={(e) => { e.stopPropagation(); handleSaveClick(); }}>
                  Save changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {design.latest_priority_variation_status && (
            <Badge 
              className={cn("text-xs border", getStatusBadgeClass(design.latest_priority_variation_status))}
              title={`Feedback: ${design.latest_priority_variation_status}`}
            >
              {design.latest_priority_variation_status} 
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs capitalize">{design.latest_version_stage || 'N/A'}</Badge>
        </div>
      </CardFooter>
    </Card>
  );
};
