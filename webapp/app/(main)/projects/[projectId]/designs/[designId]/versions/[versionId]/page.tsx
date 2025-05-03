// Trigger redeploy: trivial comment added
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from "@/components/ui/badge";
import Link from 'next/link';
import Breadcrumbs, { BreadcrumbItem } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import {
  Dialog as VariationDialog,
  DialogContent as VariationDialogContent,
  DialogDescription as VariationDialogDescription,
  DialogFooter as VariationDialogFooter,
  DialogHeader as VariationDialogHeader,
  DialogTitle as VariationDialogTitle,
  DialogTrigger as VariationDialogTrigger,
  DialogClose as VariationDialogClose,
} from '@/components/ui/dialog';
import { Label as VariationLabel } from "@/components/ui/label";
import { Textarea as VariationTextarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as zod from 'zod';
import { toast } from 'sonner';
import { VariationDetailModal } from '@/components/modals/VariationDetailModal';
import Dropzone from '@/components/ui/dropzone';
import { FileRejection } from 'react-dropzone';
import Image from 'next/image';
import { nanoid } from 'nanoid';
import { Loader2, PlusCircle, Pencil, ImageIcon, Trash2 } from 'lucide-react';

// --- Import types from central location --- 
import {
    Project,
    Design,
    Version,
    DesignStage,
    VersionRoundStatus,
    Variation,
    NewVariationData,
    VersionWithDetails,
    VariationFeedbackStatus
} from '@/types/models';

// --- Define Queue File Type --- Added
interface QueueFile {
  id: string; // Unique identifier for the queue item
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';
  progress: number;
  previewUrl: string | null; // Generated using URL.createObjectURL for images
  error?: string;
  // We can add xhr/controller later for cancellation
}

// --- Type Definitions ---
// (Ideally share these globally)

// --- Zod Schema for New Variation Form ---
const variationSchema = zod.object({
  notes: zod.string().optional(), // Notes are optional
});

// --- Zod Schema for Editing Version ---
const versionEditSchema = zod.object({
  notes: zod.string().optional(),
  stage: zod.nativeEnum(DesignStage),
  status: zod.nativeEnum(VersionRoundStatus),
});
type VersionEditFormData = zod.infer<typeof versionEditSchema>;

// --- Fetch Functions ---

// TODO: Fetch function for a single version and its details
const fetchVersionWithDetails = async (
    supabase: any, 
    versionId: string
): Promise<VersionWithDetails | null> => {
    if (!supabase || !versionId) return null;

    // 1. Fetch the version itself
    const { data: version, error: versionError } = await supabase
        .from('versions')
        .select(`
            *,
            design:designs (*, project:projects(*))
        `)
        .eq('id', versionId)
        .maybeSingle();

    if (versionError) {
        console.error('Error fetching version:', versionError);
        throw new Error(`Failed to fetch version: ${versionError.message}`);
    }
    if (!version) return null;

    // 2. Fetch variations for this version
    const { data: variations, error: variationsError } = await supabase
        .from('variations')
        .select('*') // Select all variation fields
        .eq('version_id', versionId)
        .order('variation_letter', { ascending: true });

    if (variationsError) {
        console.error('Error fetching variations:', variationsError);
        throw new Error(`Failed to fetch variations: ${variationsError.message}`);
    }

    // Simplify the nested structure from Supabase
    const projectData = version.design?.project;
    const designData = { ...version.design };
    delete designData.project; // Remove nested project from design

    // 3. Combine results
    const result: VersionWithDetails = {
        ...(version as Version), // Cast the base version data
        design: designData as Design,
        project: projectData as Project,
        variations: (variations as Variation[]) || [],
    };

    return result;
};

// --- Mutation Hooks ---

// --- Add Variation Hook --- Updated
const useAddVariation = (versionId: string, projectId: string, designId: string) => { // Added projectId, designId for path
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    // Helper to get the next letter
    const getNextVariationLetter = (existingLetters: string[]): string => {
        if (!existingLetters || existingLetters.length === 0) {
            return 'A';
        }
        // Sort letters to find the highest reliably (A, B, ..., Z)
        existingLetters.sort();
        const lastLetter = existingLetters[existingLetters.length - 1];
        // Simple increment - assumes single uppercase letters A-Z
        // TODO: Handle reaching 'Z' if needed (e.g., error, wrap to AA?)
        return String.fromCharCode(lastLetter.charCodeAt(0) + 1);
    };

    return useMutation({
        // Accept file along with notes
        mutationFn: async ({ notes, file }: { notes?: string | null, file?: File | null }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!versionId) throw new Error("Version ID is required");
            if (!projectId) throw new Error("Project ID is required for path");
            if (!designId) throw new Error("Design ID is required for path");

            // 1. Get next letter
            const { data: existingVariations, error: fetchError } = await supabase
                .from('variations')
                .select('variation_letter')
                .eq('version_id', versionId);
            if (fetchError) throw new Error('Could not determine next variation letter.');
            const existingLetters = existingVariations?.map(v => v.variation_letter) || [];
            const nextLetter = getNextVariationLetter(existingLetters);
            if (nextLetter > 'Z') throw new Error('Maximum number of variations reached.');

            // 2. Prepare initial insert data (without file_path)
            const initialInsertData: Omit<NewVariationData, 'file_path'> = { // Omit file_path initially
                version_id: versionId,
                variation_letter: nextLetter,
                notes: notes || null,
                status: VariationFeedbackStatus.PendingFeedback, 
            };

            // 3. Insert initial variation record
            const { data: newVariation, error: insertError } = await supabase
                .from('variations')
                .insert(initialInsertData)
                .select('id, variation_letter') // Select ID for file path and update
                .single();

            if (insertError) throw new Error(`Failed to add variation: ${insertError.message}`);
            if (!newVariation?.id) throw new Error('Failed to get ID of newly created variation.');

            // 4. Handle File Upload if provided
            let finalFilePath: string | null = null;
            if (file) {
                const fileExt = file.name.split('.').pop();
                const cleanFileName = `${nextLetter}.${fileExt}`; // Use variation letter as filename base
                finalFilePath = `projects/${projectId}/designs/${designId}/versions/${versionId}/variations/${newVariation.id}/${cleanFileName}`;
                const bucketName = 'design-variations';
                
                console.log(`[AddVariationUpload] Uploading ${file.name} to ${finalFilePath}`);
                const { error: uploadError } = await supabase.storage
                    .from(bucketName)
                    .upload(finalFilePath, file, { upsert: false }); // Don't upsert on initial create

                if (uploadError) {
                    console.error(`[AddVariationUpload] Upload failed for ${file.name}:`, uploadError);
                    // Optional: Delete the variation record if upload fails?
                    // await supabase.from('variations').delete().eq('id', newVariation.id);
                    throw new Error(`Storage upload failed: ${uploadError.message}`);
                }
                console.log(`[AddVariationUpload] Successfully uploaded ${file.name}`);

                // 5. Update variation record with file_path
                const { error: updateError } = await supabase
                    .from('variations')
                    .update({ file_path: finalFilePath })
                    .eq('id', newVariation.id);

                if (updateError) {
                    console.error(`[AddVariationUpload] Failed to link file path for variation ${newVariation.id}:`, updateError);
                    // Don't necessarily fail the whole mutation, but warn the user
                    toast.warning(`Variation ${nextLetter} created, but failed to link file.`);
                    // Fall through to return success, but without the file path technically linked
                }
                 console.log(`[AddVariationUpload] Successfully linked ${finalFilePath} to variation ${newVariation.id}`);
            }
            
            // Return the ID and Letter, potentially file path if successful
            return { ...newVariation, file_path: finalFilePath }; 
        },
        onSuccess: (data) => {
            // Don't invalidate here; will be done after the whole queue finishes
            // queryClient.invalidateQueries({ queryKey: ['version', versionId, 'details'] }); 
            // We can keep the toast here for individual success if desired, 
            // but the main toast will be in handleAddVariationSubmit
            // toast.success(`Variation ${data.variation_letter} added successfully!`); 
            console.log(`[useAddVariation onSuccess] Variation ${data.variation_letter} created.`);
        },
        onError: (error) => {
            // Log error here, but the main toast will be in handleAddVariationSubmit
            console.error("[useAddVariation onError]", error);
            // toast.error(error.message); 
        },
    });
};

// --- Update Version Hook ---
const useUpdateVersion = (versionId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (updatedData: VersionEditFormData) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!versionId) throw new Error("Version ID is required");

            const { data, error } = await supabase
                .from('versions')
                .update({
                    notes: updatedData.notes || null, // Ensure null if empty string
                    stage: updatedData.stage,
                    status: updatedData.status,
                })
                .eq('id', versionId)
                .select()
                .single();

            if (error) {
                console.error('Error updating version:', error);
                throw new Error(`Failed to update version: ${error.message}`);
            }
            return data;
        },
        onSuccess: (data) => {
            toast.success(`Version V${data.version_number} updated successfully!`);
            // Invalidate the specific version query to refetch
            queryClient.invalidateQueries({ queryKey: ['version', versionId] });
            // Optionally invalidate variations if status changes might affect them
            // queryClient.invalidateQueries({ queryKey: ['variations', versionId] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- Replace Variation File Hook --- Added
export const useReplaceVariationFile = (variationId: string, versionId: string, designId: string, projectId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ newFile, oldFilePath }: { newFile: File, oldFilePath: string }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId || !newFile || !oldFilePath) throw new Error("Missing data for file replacement");

            const bucketName = 'design-variations';
            let newFilePath = oldFilePath; // Default to old path if something goes wrong

            // 1. Delete the old file from storage
            console.log(`[ReplaceFile] Deleting old file: ${oldFilePath}`);
            const { error: deleteError } = await supabase.storage
                .from(bucketName)
                .remove([oldFilePath]);
            
            if (deleteError) {
                console.error(`[ReplaceFile] Failed to delete old file ${oldFilePath}:`, deleteError);
                // Don't necessarily fail yet, maybe the file didn't exist?
                // But log a warning.
                toast.warning(`Could not remove previous file, proceeding with upload.`);
            }

            // 2. Construct the new file path (keeping folder structure, updating filename if needed)
            // Option A: Keep existing filename structure (just variation letter)
            // const fileExt = newFile.name.split('.').pop();
            // const variationLetter = oldFilePath.split('/').pop()?.split('.')[0]; // Extract letter
            // const newFileName = `${variationLetter || 'file'}.${fileExt}`;
            // newFilePath = `projects/${projectId}/designs/${designId}/versions/${versionId}/variations/${variationId}/${newFileName}`;

            // Option B: Use the new file's name (simpler)
            newFilePath = `projects/${projectId}/designs/${designId}/versions/${versionId}/variations/${variationId}/${newFile.name}`;

            // 3. Upload the new file
            console.log(`[ReplaceFile] Uploading new file to: ${newFilePath}`);
            const { error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(newFilePath, newFile, { upsert: false }); // Don't upsert, should be replacing

            if (uploadError) {
                console.error(`[ReplaceFile] Upload failed for ${newFile.name}:`, uploadError);
                throw new Error(`Storage upload failed: ${uploadError.message}`);
            }

            // 4. Update the variation record with the new file path
            console.log(`[ReplaceFile] Updating variation ${variationId} with new path: ${newFilePath}`);
            const { data: updatedVariation, error: updateError } = await supabase
                .from('variations')
                .update({ file_path: newFilePath, updated_at: new Date().toISOString() })
                .eq('id', variationId)
                .select('id, file_path') // Select needed data
                .single();

            if (updateError) {
                console.error(`[ReplaceFile] Failed update variation ${variationId} file path:`, updateError);
                // Maybe don't throw, but the link is broken
                toast.error('File uploaded, but failed to update variation record.');
                // Return something to indicate partial success?
                return { id: variationId, file_path: null }; // Indicate failure to link
            }
            
             return updatedVariation; // Return updated variation data
        },
        onSuccess: (data) => {
             if (data?.file_path) {
                 toast.success('Variation file replaced successfully!');
             } 
            // Invalidate queries to refetch version details (incl. variations)
            queryClient.invalidateQueries({ queryKey: ['version', versionId, 'details'] });
        },
        onError: (error) => {
            toast.error(`File replacement failed: ${error.message}`);
        },
    });
};

// --- Delete Variation Hook --- Renamed & Updated
export const useDeleteVariation = (versionId: string, variationId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        // Takes filePath for attempting storage cleanup, but primary action is DB delete
        mutationFn: async ({ filePath }: { filePath: string | null | undefined }) => { 
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Variation ID required for deletion");

            const bucketName = 'design-variations';

            // 1. Attempt to delete the file from storage (best effort)
            if (filePath) {
                console.log(`[DeleteVariation] Attempting to delete file: ${filePath}`);
                const { error: deleteError } = await supabase.storage
                    .from(bucketName)
                    .remove([filePath]);
                
                if (deleteError) {
                    // Log error but don't stop the DB deletion
                    console.warn(`[DeleteVariation] Failed to delete file ${filePath} from storage, proceeding with DB deletion:`, deleteError);
                    toast.warning(`Could not remove associated file from storage.`); 
                }
            } else {
                console.log(`[DeleteVariation] No file path provided for variation ${variationId}, skipping storage deletion.`);
            }

            // 2. Delete the variation record from the database
            console.log(`[DeleteVariation] Deleting variation record ${variationId} from database.`);
            const { error: dbDeleteError } = await supabase
                .from('variations')
                .delete()
                .eq('id', variationId);
            
            if (dbDeleteError) {
                console.error(`[DeleteVariation] Failed to delete variation ${variationId} from database:`, dbDeleteError);
                throw new Error('Failed to delete variation record.');
            }

            // Return something simple on success, maybe the ID deleted
            return { deletedVariationId: variationId }; 
        },
        onSuccess: (data) => {
            // Use variationId passed to hook, as data might just be {deletedVariationId: id}
            toast.success(`Variation deleted successfully!`); 
            // Invalidate queries to refetch version details (incl. variations)
            queryClient.invalidateQueries({ queryKey: ['version', versionId, 'details'] });
        },
        onError: (error) => {
            toast.error(`Variation deletion failed: ${error.message}`);
        },
    });
};

// --- Component: Variation Card ---
const VariationCard: React.FC<{ variation: Variation, onClick: () => void }> = ({ variation, onClick }) => {
    const { supabase } = useAuth();
    const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Prioritize thumbnail, then preview, then original file for card view
        const pathToFetch = variation.thumbnail_path || variation.preview_path || variation.file_path;

        if (pathToFetch && supabase) {
            setIsLoading(true);
            const fetchThumbnailUrl = async () => {
                try {
                    const { data, error } = await supabase.storage
                        .from('design-variations')
                        .createSignedUrl(pathToFetch, 3600); // 1 hour expiry
                    
                    if (error) {
                        console.error(`Error fetching signed URL for card ${variation.id}: ${pathToFetch}`, error);
                        setThumbnailUrl(null);
                    } else {
                        setThumbnailUrl(data.signedUrl);
                    }
                } catch (err) {
                     console.error(`Exception fetching signed URL for card ${variation.id}: ${pathToFetch}`, err);
                     setThumbnailUrl(null);
                }
                 setIsLoading(false);
            };
            fetchThumbnailUrl();
        } else {
             setThumbnailUrl(null);
             setIsLoading(false);
        }
    }, [variation.thumbnail_path, variation.preview_path, variation.file_path, supabase]); // Updated dependencies

    return (
        <Card 
            className="cursor-pointer hover:shadow-lg transition-shadow duration-200 overflow-hidden group" 
            onClick={onClick}
        >
            <CardContent className="p-0 aspect-square flex items-center justify-center bg-muted relative">
                {isLoading ? (
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                ) : thumbnailUrl ? (
                    <Image 
                        src={thumbnailUrl}
                        alt={`Variation ${variation.variation_letter}`}
                        layout="fill"
                        objectFit="contain" // Use contain to avoid cropping
                        className="transition-transform duration-300 group-hover:scale-105"
                    />
                ) : (
                    <ImageIcon className="h-12 w-12 text-muted-foreground" /> // Placeholder
                )}
            </CardContent>
            <CardFooter className="p-2 flex justify-between items-center bg-background border-t">
                <span className="font-semibold text-lg">{variation.variation_letter}</span>
                <Badge variant={
                    variation.status === VariationFeedbackStatus.Rejected ? 'destructive' 
                    : 'secondary' // Default for Approved, Pending, Needs Changes
                }>
                    {variation.status}
                </Badge>
            </CardFooter>
        </Card>
    );
};

// --- Component ---
export default function VersionDetailPage() {
    const { supabase } = useAuth();
    const params = useParams();
    const projectId = params.projectId as string;
    const designId = params.designId as string;
    const versionId = params.versionId as string;
    const queryClient = useQueryClient();
    const [isAddVariationDialogOpen, setIsAddVariationDialogOpen] = useState(false);
    const [isEditingVersion, setIsEditingVersion] = useState(false);
    
    // --- State for Variation Detail Modal --- Added
    const [selectedVariation, setSelectedVariation] = useState<Variation | null>(null);
    const [isVariationModalOpen, setIsVariationModalOpen] = useState(false);
    
    // --- State for Signed URLs --- Added
    const [variationSignedUrls, setVariationSignedUrls] = useState<Record<string, string>>({});
    const [isLoadingUrls, setIsLoadingUrls] = useState(false);

    // --- Refactored State for Upload Queue --- Changed state variable
    const [uploadQueue, setUploadQueue] = useState<QueueFile[]>([]); 
    const [isProcessingQueue, setIsProcessingQueue] = useState(false);

    // --- Form Hooks ---
    const {
        register: registerVariation,
        handleSubmit: handleSubmitVariation,
        reset: resetVariationForm,
        formState: { errors: variationFormErrors },
    } = useForm<zod.infer<typeof variationSchema>>({
        resolver: zodResolver(variationSchema),
        defaultValues: { notes: '' },
    });

    // Version Edit Form
    const {
        register: registerVersionEdit,
        handleSubmit: handleSubmitVersionEdit,
        control: versionEditControl, // Need control for Select components
        reset: resetVersionEditForm,
        formState: { errors: versionEditFormErrors, isSubmitting: isSubmittingVersionEdit },
    } = useForm<VersionEditFormData>({
        resolver: zodResolver(versionEditSchema),
        // Default values will be set when entering edit mode
    });

    // --- Queries ---
    const { data: versionData, isLoading, error } = useQuery<VersionWithDetails | null>({
        queryKey: ['version', versionId, 'details'],
        queryFn: () => fetchVersionWithDetails(supabase, versionId),
        enabled: !!supabase && !!versionId,
    });

    // --- Mutations ---
    const addVariationMutation = useAddVariation(versionId, projectId, designId);
    const updateVersionMutation = useUpdateVersion(versionId);
    const replaceVariationFileMutation = useReplaceVariationFile(versionId, versionId, designId, projectId);

    // --- Effect to fetch Signed URLs for Variations --- Added
    useEffect(() => {
        if (versionData?.variations && supabase) {
            const fetchUrls = async () => {
                setIsLoadingUrls(true);
                const urls: Record<string, string> = {};
                const promises = versionData.variations.map(async (variation) => {
                    if (variation.file_path) {
                        try {
                            const { data, error } = await supabase.storage
                                .from('design-variations') // Ensure this matches your bucket name
                                .createSignedUrl(variation.file_path, 60); // 60 seconds expiry
                            
                            if (error) {
                                console.error(`Error creating signed URL for ${variation.file_path}:`, error);
                            } else if (data?.signedUrl) {
                                urls[variation.id] = data.signedUrl;
                            }
                        } catch (err) {
                            console.error(`Exception creating signed URL for ${variation.file_path}:`, err);
                        }
                    }
                });
                await Promise.all(promises);
                setVariationSignedUrls(urls);
                setIsLoadingUrls(false);
            };
            fetchUrls();
        }
    }, [versionData?.variations, supabase]); // Dependency: run when variations data changes

    // --- Handlers ---
    const handleAddVariationSubmit = useCallback(async (values: zod.infer<typeof variationSchema>) => {
        const itemsToUpload = uploadQueue.filter(item => item.status === 'pending');
        if (itemsToUpload.length === 0) {
            toast.info("No files in the queue to upload.");
            return;
        }

        setIsProcessingQueue(true); 
        toast.info(`Starting upload for ${itemsToUpload.length} variation(s)...`);
        let successCount = 0;
        let errorCount = 0;

        for (const item of itemsToUpload) {
            setUploadQueue(prev => prev.map(qItem => 
                qItem.id === item.id ? { ...qItem, status: 'uploading', progress: 0, error: undefined } : qItem
            ));

            try {
                const result = await addVariationMutation.mutateAsync({ 
                    notes: values.notes, 
                    file: item.file 
                }); 
                
                setUploadQueue(prev => prev.map(qItem => 
                    qItem.id === item.id ? { ...qItem, status: 'success', progress: 100 } : qItem
                ));
                 // Individual success toast can be added back here if desired, but might be noisy
                 // toast.success(`Variation ${result.variation_letter} (${item.file.name}) uploaded successfully!`);
                 successCount++;

            } catch (error: any) {
                console.error(`Upload failed for ${item.file.name}:`, error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown upload error';
                setUploadQueue(prev => prev.map(qItem => 
                    qItem.id === item.id ? { ...qItem, status: 'error', error: errorMessage } : qItem
                ));
                // Individual error toast
                toast.error(`Upload failed for ${item.file.name}: ${errorMessage}`);
                errorCount++;
            }
        }

        setIsProcessingQueue(false); 
        toast.info(`Queue processing complete. ${successCount} succeeded, ${errorCount} failed.`);
        
        // Invalidate the query ONCE after the loop is finished
        if (successCount > 0) {
             queryClient.invalidateQueries({ queryKey: ['version', versionId, 'details'] });
        }
        
        // Don't reset dialog, let user see results

    }, [uploadQueue, addVariationMutation, setUploadQueue, queryClient, versionId]); // Added queryClient, versionId

    const handleVersionEditSubmit = (values: VersionEditFormData) => {
        updateVersionMutation.mutate(values, {
            onSuccess: () => {
                setIsEditingVersion(false); // Exit edit mode on success
            }
        });
    };

    // Set form defaults when entering edit mode
    const handleEnterEditMode = () => {
        if (versionData) {
            resetVersionEditForm({
                notes: versionData.notes || '',
                stage: versionData.stage,
                status: versionData.status,
            });
            setIsEditingVersion(true);
        }
    };

    const handleCancelEditMode = () => {
        setIsEditingVersion(false);
        // Optionally reset form again if needed, but handleEnterEditMode does it
        // resetVersionEditForm({ notes: versionData?.notes || '', stage: versionData?.stage, status: versionData?.status });
    };

    // Calculate next variation letter for display purposes
    const existingLetters = versionData?.variations.map(v => v.variation_letter) || [];
    const nextVariationLetterDisplay = getNextVariationLetterForDisplay(existingLetters);
    
    // Add handler to open the variation modal
    const handleVariationCardClick = (variation: Variation) => {
        setSelectedVariation(variation);
        setIsVariationModalOpen(true);
    };

    // --- Updated File Handlers for New Variation Queue --- Changed
    const handleNewVariationFileAccepted = useCallback((acceptedFiles: File[]) => {
        const newQueueFiles = acceptedFiles.map((file): QueueFile => {
             const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
             console.log(`Created preview URL for ${file.name}: ${previewUrl}`); // Debugging
             return {
                id: nanoid(), // Generate unique ID
                file: file,
                status: 'pending',
                progress: 0,
                previewUrl: previewUrl,
            };
        });

        setUploadQueue(prevQueue => [...prevQueue, ...newQueueFiles]);
        console.log(`Added ${newQueueFiles.length} files to queue. New queue size: ${uploadQueue.length + newQueueFiles.length}`); // Debugging
        // toast.info(`${acceptedFiles.length} file(s) added to queue.`);

    }, []); // Removed uploadQueue dependency as we use functional updates

    const handleNewVariationFileRejected = useCallback((fileRejections: FileRejection[]) => {
        fileRejections.forEach(rejection => {
             toast.error(`File rejected: ${rejection.file.name} - ${rejection.errors[0]?.message || 'Invalid file type or size'}`);
        });
    }, []);

    // --- Function to remove an item from the queue --- Added
    const handleRemoveFromQueue = useCallback((idToRemove: string) => {
         setUploadQueue(prevQueue => {
            const itemToRemove = prevQueue.find(item => item.id === idToRemove);
            if (itemToRemove?.previewUrl) {
                 console.log(`Revoking preview URL for ${itemToRemove.file.name}: ${itemToRemove.previewUrl}`); // Debugging
                 URL.revokeObjectURL(itemToRemove.previewUrl); // Revoke URL immediately on removal
            }
            const newQueue = prevQueue.filter(item => item.id !== idToRemove);
            console.log(`Removed item ${idToRemove}. New queue size: ${newQueue.length}`); // Debugging
            return newQueue;
        });
    }, []); // No dependencies needed here

    // --- Updated Function to reset dialog state --- Changed
    const resetAddVariationDialog = useCallback(() => {
        console.log('Resetting Add Variation Dialog. Current queue size:', uploadQueue.length); // Debugging
        resetVariationForm();
        // Revoke any remaining URLs
        uploadQueue.forEach(item => {
            if (item.previewUrl) {
                 console.log(`Revoking preview URL on reset for ${item.file.name}: ${item.previewUrl}`); // Debugging
                 URL.revokeObjectURL(item.previewUrl);
            }
        });
        setUploadQueue([]); // Clear the queue
        setIsAddVariationDialogOpen(false);
        console.log('Dialog reset complete. Queue should be empty.'); // Debugging
    }, [uploadQueue, resetVariationForm]); // Added dependencies

    // Update dialog open change handler - ensure reset happens on close
    const handleAddVariationOpenChange = useCallback((isOpen: boolean) => {
        if (!isOpen) {
            resetAddVariationDialog(); // Reset when dialog closes
        }
        setIsAddVariationDialogOpen(isOpen);
    }, [resetAddVariationDialog]); // Dependency on reset function

    // --- Effect to cleanup ALL preview URLs on component unmount --- Changed
    useEffect(() => {
        // This runs only when the component unmounts
        return () => {
            console.log('VersionDetailPage unmounting. Cleaning up preview URLs.'); // Debugging
            uploadQueue.forEach(item => {
                if (item.previewUrl) {
                    console.log(`Revoking preview URL on unmount for ${item.file.name}: ${item.previewUrl}`); // Debugging
                    URL.revokeObjectURL(item.previewUrl);
                }
            });
        };
    }, []); // Empty dependency array means this cleanup runs only on unmount
    
    // --- Loading & Error States ---
    if (isLoading) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /> Loading Version Details...</div>;
    }

    if (error) {
        return (
            <div className="container mx-auto p-4">
                <h1 className="text-2xl font-bold text-red-600">Error Loading Version</h1>
                <p>{(error as Error)?.message || 'An unknown error occurred.'}</p>
                {/* Provide links back up the hierarchy */}
                <div className="mt-4 space-x-4">
                    <Link href={`/projects/${projectId}/designs/${designId}`} className="text-blue-600 hover:underline">
                    Return to Design
                </Link>
                    <Link href={`/projects/${projectId}`} className="text-blue-600 hover:underline">
                        Return to Project
                    </Link>
                </div>
            </div>
        );
    }

    if (!versionData) {
        return (
            <div className="container mx-auto p-4">
                <h1 className="text-2xl font-bold">Version Not Found</h1>
                <p>The requested version could not be found.</p>
                 <div className="mt-4 space-x-4">
                    <Link href={`/projects/${projectId}/designs/${designId}`} className="text-blue-600 hover:underline">
                        Return to Design
                    </Link>
                    <Link href={`/projects/${projectId}`} className="text-blue-600 hover:underline">
                        Return to Project
                    </Link>
                </div>
            </div>
        );
    }

    // Define breadcrumb items using fetched data
    const breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Dashboard', href: '/dashboard' },
        { label: versionData.project?.name ?? 'Project', href: `/projects/${projectId}` },
        { label: versionData.design?.name ?? 'Design', href: `/projects/${projectId}/designs/${designId}` },
        { label: `V${versionData.version_number}` } // Current version page
    ];

    // --- Render --- 
    return (
        <div className="container mx-auto p-4 space-y-6">
            <Breadcrumbs items={breadcrumbItems} />

            {/* --- Version Details Card --- */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                        <CardTitle>Version Details (V{versionData.version_number})</CardTitle>
                        <CardDescription>Stage, status, and notes for this version.</CardDescription>
                    </div>
                    {!isEditingVersion && (
                        <Button variant="outline" size="sm" onClick={handleEnterEditMode}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit Version
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    {isEditingVersion ? (
                        <form onSubmit={handleSubmitVersionEdit(handleVersionEditSubmit)} className="space-y-4">
                            {/* Stage Select */}
                            <div className="space-y-1">
                                <Label htmlFor="stage">Stage</Label>
                                <Controller
                                    name="stage"
                                    control={versionEditControl}
                                    render={({ field }) => (
                                        <Select onValueChange={field.onChange} defaultValue={field.value as string | undefined}>
                                            <SelectTrigger id="stage">
                                                <SelectValue placeholder="Select stage..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.values(DesignStage).map((stage: DesignStage) => (
                                                    <SelectItem key={stage} value={stage}>
                                                        {stage.charAt(0).toUpperCase() + stage.slice(1)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                                 {versionEditFormErrors.stage && <p className="text-sm text-red-600">{versionEditFormErrors.stage.message}</p>}
                            </div>

                            {/* Status Select */}
                            <div className="space-y-1">
                                <Label htmlFor="status">Status</Label>
                                 <Controller
                                    name="status"
                                    control={versionEditControl}
                                    render={({ field }) => (
                                        <Select onValueChange={field.onChange} defaultValue={field.value as string | undefined}>
                                            <SelectTrigger id="status">
                                                <SelectValue placeholder="Select status..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.values(VersionRoundStatus).map((status: VersionRoundStatus) => (
                                                    <SelectItem key={status} value={status}>
                                                        {status}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                                 {versionEditFormErrors.status && <p className="text-sm text-red-600">{versionEditFormErrors.status.message}</p>}
                            </div>

                            {/* Notes Textarea */}
                            <div className="space-y-1">
                                <Label htmlFor="notes">Notes</Label>
                                <Textarea
                                    id="notes"
                                    placeholder="Add any notes relevant to this version..."
                                    {...registerVersionEdit("notes")}
                                />
                                {versionEditFormErrors.notes && <p className="text-sm text-red-600">{versionEditFormErrors.notes.message}</p>}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-end space-x-2 pt-2">
                                 <Button type="button" variant="outline" onClick={handleCancelEditMode} disabled={isSubmittingVersionEdit}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={isSubmittingVersionEdit || updateVersionMutation.isPending}>
                                    {isSubmittingVersionEdit || updateVersionMutation.isPending ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Save Changes
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <div className="space-y-2">
                            <p><strong>Stage:</strong> <Badge variant="secondary">{versionData.stage}</Badge></p>
                            <p><strong>Status:</strong> <Badge variant={versionData.status === 'Round Complete' ? 'default' : 'outline'}>{versionData.status}</Badge></p>
                            <p><strong>Notes:</strong> {versionData.notes || <span className="text-muted-foreground">No notes added.</span>}</p>
                            <p><strong>Created:</strong> {new Date(versionData.created_at).toLocaleDateString()}</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* --- Variations Section --- */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Variations</CardTitle>
                        <CardDescription>Variations within this version.</CardDescription>
                    </div>
                    <VariationDialog 
                        open={isAddVariationDialogOpen} 
                        onOpenChange={handleAddVariationOpenChange} // Use updated handler
                    >
                        <VariationDialogTrigger asChild>
                            {/* Add check for existingLetters length for Z limit */}
                             <Button size="sm" disabled={addVariationMutation.isPending || getNextVariationLetterForDisplay(existingLetters) > 'Z'}> 
                                <PlusCircle className="mr-2 h-4 w-4" /> Add Variation(s)
                            </Button>
                        </VariationDialogTrigger>
                        <VariationDialogContent className="sm:max-w-lg"> 
                            <VariationDialogHeader>
                                <VariationDialogTitle>Add New Variation(s)</VariationDialogTitle>
                                <VariationDialogDescription>
                                    Drop files below. Each file will become a new variation. Notes apply to the first file added.
                                </VariationDialogDescription>
                            </VariationDialogHeader>
                            {/* NOTE: Removed outer form tag if Dropzone is inside, or keep if Dropzone is separate field */}
                             <div className="space-y-4"> {/* Replaced form tag with div for now */}
                                {/* File Input Dropzone */}
                                <div className="space-y-2">
                                    <VariationLabel htmlFor="variationFile">Files</VariationLabel>
                                    <Dropzone
                                        onFilesAccepted={handleNewVariationFileAccepted}
                                        onFilesRejected={handleNewVariationFileRejected}
                                        // accept={{ 'image/*': [] }} // Example accept prop
                                        maxSize={20 * 1024 * 1024} // Increased max size example
                                        multiple={true} // Explicitly allow multiple files
                                    />
                                </div>

                                {/* Upload Queue Display Area - Added */}
                                {uploadQueue.length > 0 && (
                                    <div className="space-y-2">
                                        <VariationLabel>Upload Queue ({uploadQueue.length})</VariationLabel>
                                        <div className="h-40 w-full rounded-md border p-2 overflow-y-auto"> {/* Added basic CSS scroll */}
                                            <div className="space-y-2">
                                                {uploadQueue.map((item) => (
                                                    <div key={item.id} className="flex items-center space-x-2 p-1 border rounded-md bg-muted/50">
                                                        {item.previewUrl ? (
                                                            <Image 
                                                                src={item.previewUrl} 
                                                                alt="Preview" 
                                                                width={100}
                                                                height={100}
                                                                className="h-10 w-10 object-contain border rounded-sm flex-shrink-0"
                                                            />
                                                        ) : (
                                                            <div className="h-10 w-10 bg-muted rounded-sm flex items-center justify-center flex-shrink-0">
                                                                <ImageIcon className="h-5 w-5 text-muted-foreground" /> 
                                                            </div>
                                                        )}
                                                        <div className="text-sm overflow-hidden flex-grow">
                                                            <p className="font-medium truncate" title={item.file.name}>{item.file.name}</p>
                                                            <p className="text-xs text-muted-foreground">
                                                                {(item.file.size / 1024).toFixed(1)} KB - {item.status}
                                                                {/* TODO: Add Progress Bar later */}
                                                            </p>
                                                        </div>
                                                        <Button 
                                                            type="button" 
                                                            variant="ghost" 
                                                            size="icon" 
                                                            className="h-6 w-6 text-muted-foreground hover:text-destructive flex-shrink-0"
                                                            onClick={() => handleRemoveFromQueue(item.id)}
                                                            aria-label="Remove from queue"
                                                            disabled={item.status === 'uploading'} // Disable remove during upload
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Notes Textarea - Now outside form if we removed outer form tag */}
                                <div className="space-y-1">
                                    <VariationLabel htmlFor="variationNotes">Notes (Optional)</VariationLabel>
                                    {/* Assuming useForm is still managing this */}
                                    <VariationTextarea 
                                        id="variationNotes" 
                                        rows={3}
                                        placeholder="Enter notes about the variation(s)..."
                                        {...registerVariation("notes")} // This needs to be inside a <form> context
                                        disabled={addVariationMutation.isPending}
                                    />
                                </div>
                                
                                {/* We might need to wrap Notes and Footer in the form again if registerVariation is used */}
                                <form onSubmit={handleSubmitVariation(handleAddVariationSubmit)}>
                                     {/* Re-add Notes Textarea here if needed by react-hook-form */}
                                     {/* ... */}
                                <VariationDialogFooter>
                                        {/* Add asChild here */}
                                    <VariationDialogClose asChild>
                                            <Button type="button" variant="outline" onClick={resetAddVariationDialog} disabled={addVariationMutation.isPending}>Cancel</Button>
                                    </VariationDialogClose>
                                        {/* Changed button text, disabled if queue is empty */}
                                        <Button 
                                            type="submit" 
                                            disabled={addVariationMutation.isPending || uploadQueue.filter((f: QueueFile) => f.status === 'pending').length === 0}
                                        >
                                            {addVariationMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...</> : `Upload Queued Files`}
                                    </Button>
                                </VariationDialogFooter>
                            </form>
                            </div> {/* End of space-y-4 div */}
                        </VariationDialogContent>
                    </VariationDialog>
                </CardHeader>
                <CardContent>
                   {isLoading || isLoadingUrls ? ( 
                     <div className="flex justify-center items-center p-4"><Loader2 className="h-6 w-6 animate-spin" /> Loading Variations...</div>
                   ) : versionData.variations && versionData.variations.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {versionData.variations.map((variation: Variation) => {
                                const signedUrl = variationSignedUrls[variation.id];
                                return (
                                    <VariationCard 
                                        key={variation.id} 
                                        variation={variation} 
                                        onClick={() => handleVariationCardClick(variation)}
                                    />
                                );
                            })}
                        </div>
                   ) : (
                     <p className="italic text-muted-foreground text-center p-4">No variations have been created for this version yet.</p>
                   )}
                </CardContent>
            </Card>

            {/* Render the Variation Detail Modal (controlled) */}
            <VariationDetailModal 
                isOpen={isVariationModalOpen}
                onOpenChange={setIsVariationModalOpen}
                variation={selectedVariation} 
                project={versionData.project}
                design={versionData.design}
                version={versionData as Version}
                versionId={versionId}
                projectId={projectId}
                designId={designId}
            />
        </div>
    );
}

// Helper function outside component for display calculation
function getNextVariationLetterForDisplay(existingLetters: string[]): string {
    if (!existingLetters || existingLetters.length === 0) return 'A';
    existingLetters.sort();
    const lastLetter = existingLetters[existingLetters.length - 1];
    if (lastLetter >= 'Z') return '>Z'; // Indicate limit reached for display
    return String.fromCharCode(lastLetter.charCodeAt(0) + 1);
} 