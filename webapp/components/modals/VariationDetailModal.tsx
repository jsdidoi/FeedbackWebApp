'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogDescription, 
    DialogFooter, 
    DialogClose 
} from '@/components/ui/dialog';
import { Badge } from "@/components/ui/badge";
import { Button } from '@/components/ui/button';
import { Loader2, ImageOff, X as CloseIcon, Upload, Trash2 } from 'lucide-react'; // Use X for close, add Trash2 icon
import { Variation, Project, Design, Version } from '@/types/models'; // Import necessary types
import { useAuth } from '@/providers/AuthProvider'; // To get supabase for signed URLs
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';
import { useUpdateVariationStatus, useReplaceVariationFile, useDeleteVariation } from '@/app/(main)/projects/[projectId]/designs/[designId]/versions/[versionId]/page'; // Updated import
import { VariationFeedbackStatus } from '@/types/models';
import { getProcessedImagePath, getPublicImageUrl } from '@/lib/imageUtils';
import { LARGE_WIDTH } from '@/lib/constants/imageConstants';
import Image from 'next/image';

interface VariationDetailModalProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    variation: Variation | null;
    versionId: string;
    project?: Project | null; // Optional parent info
    design?: Design | null;   // Optional parent info
    version?: Version | null; // Optional parent info
    projectId: string;
    designId: string;
}

// Environment variables (needed for image URLs)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const processedBucketName = process.env.NEXT_PUBLIC_SUPABASE_PROCESSED_BUCKET;

export const VariationDetailModal: React.FC<VariationDetailModalProps> = ({ 
    isOpen, 
    onOpenChange, 
    variation, 
    versionId,
    project,
    design,
    version,
    projectId,
    designId
}) => {
    const { supabase } = useAuth();
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [isLoadingUrl, setIsLoadingUrl] = useState(false);
    const [urlError, setUrlError] = useState<string | null>(null);

    // --- State for File Replacement --- Added
    const replacementFileInputRef = useRef<HTMLInputElement>(null);
    const [isReplacingFile, setIsReplacingFile] = useState(false); // For loading indicator

    // Updated state name for clarity
    const [isDeletingVariation, setIsDeletingVariation] = useState(false);

    // Fetch processed image URL
    useEffect(() => {
        setIsLoadingUrl(true);
        setImageUrl(null);
        setUrlError(null);

        if (!isOpen) {
             setIsLoadingUrl(false);
             return; // Don't process if modal is closed
        }

        if (!supabaseUrl || !processedBucketName) {
            setUrlError("Image configuration error.");
            console.error("Error: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PROCESSED_BUCKET is not set.");
            setIsLoadingUrl(false);
            return;
        }

        // Use the original file_path to generate the processed URL
        const originalFilePath = variation?.file_path;

        if (originalFilePath) {
             try {
                const processedPath = getProcessedImagePath(originalFilePath, LARGE_WIDTH);
                const publicUrl = getPublicImageUrl(supabaseUrl, processedBucketName, processedPath);
                setImageUrl(publicUrl);
                setUrlError(null);
             } catch (err: unknown) {
                 console.error(`Error generating processed URL for ${originalFilePath}:`, err);
                 setUrlError("Could not generate image URL.");
                 setImageUrl(null);
                 toast.error("Could not load variation image."); // Keep user feedback
             }
        } else {
            // No original file path available
            setUrlError(null); // Not an error, just no image
            setImageUrl(null);
        }
        setIsLoadingUrl(false);

    }, [isOpen, variation?.file_path, supabaseUrl, processedBucketName]); // Dependencies

    // --- Instantiate Mutation Hooks --- 
    const updateStatusMutation = useUpdateVariationStatus(versionId, variation?.id || '');
    const replaceFileMutation = useReplaceVariationFile(
        variation?.id || '', 
        versionId, 
        designId || '', 
        projectId || '' 
    ); 
    // Renamed hook instance
    const deleteVariationMutation = useDeleteVariation(versionId, variation?.id || '');

    if (!variation) {
        return null; // Don't render anything if no variation is selected
    }

    // --- Handlers --- Added
    const handleStatusUpdate = (newStatus: VariationFeedbackStatus) => {
        updateStatusMutation.mutate(newStatus, {
            onSuccess: () => {
                onOpenChange(false); // Close modal on successful status change
            }
            // onError is handled globally in the hook (toast)
        });
    };

    const handleClose = () => onOpenChange(false);

    // --- Handler to trigger file input --- Added
    const handleReplaceFileClick = () => {
        replacementFileInputRef.current?.click();
    };

    // Update handler for when replacement file is selected
    const handleReplacementFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !variation?.id || !variation?.file_path) return; // Ensure old path exists

        setIsReplacingFile(true);

        // Call the actual replacement mutation hook
        replaceFileMutation.mutate({ newFile: file, oldFilePath: variation.file_path }, {
            onSuccess: () => {
                console.log("File replaced successfully");
                // Force a refetch of the signed URL by temporarily clearing it
                // The useEffect will pick up the change in variation data via query invalidation
                setImageUrl(null);
                setIsLoadingUrl(true); // Show loading while URL refetches
            },
            onError: (err) => {
                // Error toast is handled globally in the hook
                console.error("File replacement mutation failed:", err);
            },
            onSettled: () => {
                 setIsReplacingFile(false);
                 // Clear the file input value
                 if (replacementFileInputRef.current) {
                     replacementFileInputRef.current.value = '';
                 }
            }
        });
    };

    // Renamed handler for clarity and updated logic
    const handleDeleteVariationClick = async () => {
        if (!variation?.id) {
             toast.error("Cannot delete variation without an ID.");
             return;
        }
        
        // Updated confirmation message
        if (!confirm('Are you sure you want to permanently delete this variation (including its file and feedback)? This cannot be undone.')) return;
        
        setIsDeletingVariation(true); // Use renamed state setter

        // Call the renamed delete mutation hook
        // Pass the file path for storage cleanup attempt
        deleteVariationMutation.mutate({ filePath: variation.file_path }, { 
            onSuccess: () => {
                console.log('Variation deleted successfully via hook');
                // Close the modal on success
                onOpenChange(false); 
                // Query invalidation happens in the hook's onSuccess
            },
            onError: (err) => { 
                 // Error toast handled globally in the hook
                 console.error('Variation deletion mutation failed:', err);
            },
            onSettled: () => {
                 setIsDeletingVariation(false); // Use renamed state setter
            }
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
             {/* Removed DialogTrigger - controlled externally */}
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0"> 
                {/* Header Section */}
                <DialogHeader className="p-4 border-b flex flex-row justify-between items-center">
                     <div>
                         <DialogTitle className="text-lg">
                             {design?.name ?? 'Design'} - V{version?.version_number ?? 'N'} / Var {variation.variation_letter}
                         </DialogTitle>
                         <DialogDescription>
                             Project: {project?.name ?? '... '}
                         </DialogDescription>
                    </div>
                    {/* Close Button */}
                    <DialogClose asChild>
                        <Button variant="ghost" size="icon" aria-label="Close">
                            <CloseIcon className="h-4 w-4" />
                        </Button>
                    </DialogClose>
                 </DialogHeader>

                {/* Main Content Area (Image + Feedback) */}
                <div className="flex-1 grid grid-cols-3 overflow-hidden"> 
                    {/* Image Display Column - Add Delete Button */}
                     <div className="col-span-2 bg-muted flex items-center justify-center overflow-hidden p-4 relative group"> {/* Added relative/group */}
                         {/* Hidden File Input */}
                         <input 
                            type="file" 
                            ref={replacementFileInputRef} 
                            onChange={handleReplacementFileSelected}
                            className="hidden" 
                            // accept="image/*" // Add appropriate accept types
                         />
                         {/* Loading Overlay for Deletion/Replacement */}
                         {(isReplacingFile || isDeletingVariation) && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                                <Loader2 className="h-10 w-10 animate-spin text-white" />
                            </div>
                         )}
                         {/* Image or Placeholder */}
                         {isLoadingUrl ? (
                             <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
                         ) : urlError ? (
                             <div className="flex flex-col items-center justify-center text-destructive p-4">
                                <ImageOff className="h-16 w-16 mb-2" />
                                <span className="text-sm text-center">{urlError}</span>
                           </div>
                         ) : imageUrl ? (
                             <Image 
                                 src={imageUrl} 
                                 alt={`Variation ${variation.variation_letter}`} 
                                 width={100}
                                 height={100}
                                 className="max-w-full max-h-full object-contain rounded-lg"
                                 onError={() => {
                                     console.error(`Failed to load image: ${imageUrl}`);
                                     setUrlError("Failed to load image from URL.");
                                     setImageUrl(null); // Clear broken URL
                                 }}
                             />
                         ) : (
                              <div className="flex flex-col items-center justify-center text-muted-foreground">
                                 <ImageOff className="h-16 w-16 mb-2" />
                                 <span className="text-sm">Image not available</span>
                             </div>
                         )}
                         
                         {/* Action Buttons - Adjust conditional rendering */}
                         {/* Container div still shows on hover over the area */}
                         <div className={`absolute bottom-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 ${
                            // Hide entirely if we are actively replacing/deleting or if there's a URL error
                            (isReplacingFile || isDeletingVariation || urlError) ? 'hidden' : '' 
                         }`}> 
                            {/* Replace Button: Only show if image exists */}
                            {imageUrl && (
                                <Button 
                                    variant="outline"
                                    size="sm"
                                    onClick={handleReplaceFileClick}
                                    aria-label="Replace variation file"
                                    disabled={isDeletingVariation} // Also disable if deleting
                                >
                                    <Upload className="h-4 w-4 mr-2" />
                                    Replace File
                                </Button>
                            )}
                            {/* Delete Button: Always show unless replacing/deleting */}
                            <Button 
                                variant="destructive"
                                size="sm"
                                onClick={handleDeleteVariationClick} 
                                aria-label="Delete variation"
                                disabled={isReplacingFile || isDeletingVariation} // Disable if replacing OR deleting
                            >
                                {isDeletingVariation ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/> : <Trash2 className="h-4 w-4 mr-2" />}
                                Delete Variation
                            </Button>
                        </div>
                     </div>

                    {/* Feedback Column */}
                    <div className="col-span-1 border-l flex flex-col h-full">
                        <Tabs defaultValue="comments" className="flex-1 flex flex-col overflow-hidden p-4">
                            <TabsList className="grid w-full grid-cols-2 mb-4">
                                <TabsTrigger value="comments">Comments</TabsTrigger>
                                <TabsTrigger value="notes">Designer Notes</TabsTrigger>
                            </TabsList>
                            <TabsContent value="comments" className="flex-1 overflow-y-auto">
                                <p>Comments placeholder</p>
                                {/* TODO: Implement Comments UI */}
                                <div className="mt-auto">
                                    <textarea placeholder="Add a general comment..." className="w-full border p-2 rounded text-sm mb-2"></textarea>
                                    <Button size="sm">Submit</Button>
                                </div>
                            </TabsContent>
                            <TabsContent value="notes" className="flex-1 overflow-y-auto">
                                <p>Designer notes placeholder</p>
                                {/* TODO: Implement Designer Notes UI */}
                            </TabsContent>
                        </Tabs>
                     </div>
                 </div>

                {/* Footer Actions */}
                <DialogFooter className="p-4 border-t">
                    <p className="text-sm mr-auto">Status: <Badge variant="secondary">{variation.status}</Badge></p>
                    {/* Action Buttons with onClick handlers */}
                    <Button 
                        variant="outline"
                        onClick={() => handleStatusUpdate(VariationFeedbackStatus.NeedsChanges)}
                        disabled={updateStatusMutation.isPending}
                    >
                         {updateStatusMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Needs Update
                    </Button>
                    <Button 
                        variant="destructive"
                        onClick={() => handleStatusUpdate(VariationFeedbackStatus.Rejected)}
                        disabled={updateStatusMutation.isPending}
                    >
                        {updateStatusMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reject
                    </Button>
                    <Button
                        onClick={() => handleStatusUpdate(VariationFeedbackStatus.Approved)}
                        disabled={updateStatusMutation.isPending}
                    >
                        {updateStatusMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve
                    </Button>
                 </DialogFooter>
             </DialogContent>
        </Dialog>
    );
}; 