'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from "@/components/ui/badge";
import { Loader2, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import Breadcrumbs, { BreadcrumbItem } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as zod from 'zod';
import { toast } from 'sonner';
import Dropzone from '@/components/ui/dropzone';
import { Progress } from "@/components/ui/progress";
import { useRef } from 'react';
import { getProcessedImagePath, getPublicImageUrl } from '@/lib/imageUtils';
import { LARGE_WIDTH } from '@/lib/constants/imageConstants';

// --- Type Definitions ---
// (Ideally share these globally)

// Project
type Project = { id: string; name: string; };

// Design
type Design = { id: string; name: string; };

// Version
type Version = { id: string; version_number: number; };

// Variation
const variationFeedbackStatuses = ['Pending Feedback', 'Needs Changes', 'Approved', 'Rejected'] as const;
type VariationFeedbackStatus = typeof variationFeedbackStatuses[number]; 
type Variation = {
    id: string;
    version_id: string;
    variation_letter: string; 
    notes: string | null;
    status: VariationFeedbackStatus;
    created_at: string;
    file_path: string | null; // Added field for storage path
};

// --- Zod Schema for Editing Variation ---
const variationEditSchema = zod.object({
  notes: zod.string().optional(),
  status: zod.enum(variationFeedbackStatuses),
});
type VariationEditFormData = zod.infer<typeof variationEditSchema>;

// Interface for tracking individual file upload state
interface UploadingFileInfo {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';
  progress: number;
  error?: string;
  xhr?: XMLHttpRequest;
}

// Environment variables (needed for image URLs)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const processedBucketName = process.env.NEXT_PUBLIC_SUPABASE_PROCESSED_BUCKET;

// --- Fetch Functions ---

// Fetch Project (for breadcrumbs)
const fetchProject = async (supabase: any, projectId: string): Promise<Project | null> => {
    if (!projectId) return null;
    const { data, error } = await supabase.from('projects').select('id, name').eq('id', projectId).single();
    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching project:', error);
        throw new Error(error.message);
    }
    return data;
};

// Fetch Design (for breadcrumbs)
const fetchDesign = async (supabase: any, designId: string): Promise<Design | null> => {
    if (!designId) return null;
    const { data, error } = await supabase.from('designs').select('id, name').eq('id', designId).single();
    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching design:', error);
        throw new Error(error.message);
    }
    return data;
};

// Fetch Version (for breadcrumbs)
const fetchVersion = async (supabase: any, versionId: string): Promise<Version | null> => {
    if (!versionId) return null;
    const { data, error } = await supabase.from('versions').select('id, version_number').eq('id', versionId).single();
    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching version:', error);
        throw new Error(error.message);
    }
    return data;
};

// Fetch Specific Variation
const fetchVariation = async (supabase: any, variationId: string): Promise<Variation | null> => {
    if (!variationId) return null;
    const { data, error } = await supabase
        .from('variations')
        .select('id, version_id, variation_letter, notes, status, created_at, file_path') // Select new field
        .eq('id', variationId)
        .single();
    
    // Log the full error object for more details
    if (error && error.code !== 'PGRST116') { // PGRST116 means "Resource not found", which is handled later
        console.error('Error fetching variation (Full Error Object):', error); // Log the whole error object
        throw new Error(error.message || 'Failed to fetch variation'); // Keep throwing a basic message
    }
    return data;
};

// --- Mutation Hooks ---

// --- Update Variation Hook ---
const useUpdateVariation = (variationId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (updatedData: VariationEditFormData) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Variation ID is required");

            const { data, error } = await supabase
                .from('variations')
                .update({
                    notes: updatedData.notes || null, // Ensure null if empty string
                    status: updatedData.status,
                })
                .eq('id', variationId)
                .select()
                .single();

            if (error) {
                console.error('Error updating variation:', error);
                throw new Error(`Failed to update variation: ${error.message}`);
            }
            return data;
        },
        onSuccess: (data) => {
            toast.success(`Variation ${data.variation_letter} updated successfully!`);
            // Invalidate the specific variation query to refetch
            queryClient.invalidateQueries({ queryKey: ['variation', variationId] });
             // Optionally invalidate the list on the parent page if status is displayed there
             // queryClient.invalidateQueries({ queryKey: ['variations', data.version_id] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- Upload Hook Refactor (Removed - Logic integrated into component) ---
// We'll manage the queue and individual uploads directly in the component state for now.

// Helper function to get filename from path
const getFilenameFromPath = (path: string | null | undefined): string | null => {
    if (!path) return null;
    return path.substring(path.lastIndexOf('/') + 1);
};

// --- Component ---
export default function VariationDetailPage() {
    const { supabase } = useAuth();
    const params = useParams();
    const projectId = params.projectId as string;
    const designId = params.designId as string;
    const versionId = params.versionId as string;
    const variationId = params.variationId as string;
    const queryClient = useQueryClient();
    const [isEditingVariation, setIsEditingVariation] = useState(false);
    
    // State for upload queue
    const [uploadQueue, setUploadQueue] = useState<UploadingFileInfo[]>([]);
    // Ref to hold the latest queue state for callbacks
    const uploadQueueRef = useRef(uploadQueue);
    
    // State for existing file display (changed from signedUrl to imageUrl)
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [urlLoading, setUrlLoading] = useState<boolean>(false);
    const [urlError, setUrlError] = useState<string | null>(null);

    // Concurrency Limit
    const MAX_CONCURRENT_UPLOADS = 3;

    // --- Form Hooks ---
    const {
        register: registerVariationEdit,
        handleSubmit: handleSubmitVariationEdit,
        control: variationEditControl,
        reset: resetVariationEditForm,
        formState: { errors: variationEditFormErrors, isSubmitting: isSubmittingVariationEdit },
    } = useForm<VariationEditFormData>({
        resolver: zodResolver(variationEditSchema),
        // Default values set when entering edit mode
    });

    // --- Queries ---
    const { data: project, isLoading: isLoadingProject } = useQuery<Project | null>({
        queryKey: ['project', projectId],
        queryFn: () => fetchProject(supabase, projectId),
        enabled: !!supabase && !!projectId,
        staleTime: Infinity,
    });

    const { data: design, isLoading: isLoadingDesign } = useQuery<Design | null>({
        queryKey: ['design', designId],
        queryFn: () => fetchDesign(supabase, designId),
        enabled: !!supabase && !!designId,
        staleTime: Infinity,
    });

    const { data: version, isLoading: isLoadingVersion } = useQuery<Version | null>({
        queryKey: ['version', versionId],
        queryFn: () => fetchVersion(supabase, versionId),
        enabled: !!supabase && !!versionId,
        staleTime: Infinity,
    });

    const { data: variation, isLoading: isLoadingVariation, error: variationError } = useQuery<Variation | null>({
        queryKey: ['variation', variationId],
        queryFn: () => fetchVariation(supabase, variationId),
        enabled: !!supabase && !!variationId,
    });

    // --- Effects ---
    // Effect to keep the ref updated with the latest queue state
    useEffect(() => {
        uploadQueueRef.current = uploadQueue;
    }, [uploadQueue]);

    // Effect for generating public URL for existing processed file
    useEffect(() => {
        setUrlLoading(true);
        setUrlError(null);
        setImageUrl(null);

        if (!supabaseUrl || !processedBucketName) {
            setUrlError("Image configuration error.");
            console.error("Error: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PROCESSED_BUCKET is not set.");
            setUrlLoading(false);
            return;
        }

        if (variation?.file_path) {
            try {
                const processedPath = getProcessedImagePath(variation.file_path, LARGE_WIDTH);
                const publicUrl = getPublicImageUrl(supabaseUrl, processedBucketName, processedPath);
                setImageUrl(publicUrl);
                setUrlError(null);
            } catch (err: any) {
                console.error(`Error generating public URL for ${variation.file_path}:`, err);
                setUrlError('Failed to generate image URL.');
                setImageUrl(null);
            }
            setUrlLoading(false);
        } else {
            // No file path exists for this variation
            setUrlError(null); // Not an error, just no image
            setUrlLoading(false);
        }
    }, [variation?.file_path, supabaseUrl, processedBucketName]); // Re-run if path or config changes

    // Effect to cleanup preview URLs for the upload queue
    useEffect(() => {
        return () => uploadQueue.forEach(fileInfo => {
            if (fileInfo.previewUrl) URL.revokeObjectURL(fileInfo.previewUrl);
        });
    }, []); 

    // --- Add Mutation Hook for updating file path after upload ---
    const updateVariationFilePathMutation = useMutation({
        mutationFn: async (newFilePath: string) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Variation ID is required");

            const { data, error } = await supabase
                .from('variations')
                .update({ file_path: newFilePath })
                .eq('id', variationId)
                .select()
                .single();

            if (error) {
                console.error('Error updating variation file path:', error);
                throw new Error(`Failed to update variation file path: ${error.message}`);
            }
            return data;
        },
        onSuccess: (data) => {
             // No need for a separate toast here, upload success toast is sufficient
             console.log(`Variation ${data.variation_letter} file path updated to: ${data.file_path}`);
             // Invalidate variation data to show the new file display
             queryClient.invalidateQueries({ queryKey: ['variation', variationId] });
        },
        onError: (error) => {
            // Toast handled in the calling function (xhr.onload)
            console.error("Mutation error updating file path:", error);
        },
    });

    // --- Function to Start Single File Upload (MODIFIED) ---
    const startSingleFileUpload = useCallback(async (fileId: string) => {
        // Get the CURRENT queue state from the ref
        const currentQueue = uploadQueueRef.current;
        const fileInfo = currentQueue.find(f => f.id === fileId);

        // Check if file exists and is actually in 'uploading' state now
        if (!fileInfo || fileInfo.status !== 'uploading') {
            console.warn(`[startSingleFileUpload] Skipping ${fileId}. Reason: Not found in queue or status is not 'uploading'. Status: ${fileInfo?.status}`);
            return; 
        }

        // Get the file object from the found info
        const currentFileToUpload = fileInfo.file; 

        console.log(`[startSingleFileUpload - Step 3] Proceeding with async upload logic for ${currentFileToUpload.name}`);
        if (!supabase) {
             console.error(`[startSingleFileUpload - Step 3] Supabase client is missing! Cannot upload ${(currentFileToUpload as File).name}`);
             // Update state to show error
             setUploadQueue(prevQueue => prevQueue.map(f => f.id === fileId ? { ...f, status: 'error', error: 'Supabase client unavailable' } : f));
             return;
        }

        const filePath = `projects/${projectId}/designs/${designId}/versions/${versionId}/variations/${variationId}/${(currentFileToUpload as File).name}`;
        const bucketName = 'design-variations';

        try {
            console.log(`[startSingleFileUpload - Step 4] Attempting to get signed URL for bucket '${bucketName}', path: ${filePath}`);
            const { data: uploadUrlData, error: urlError } = await supabase.storage
                .from(bucketName)
                .createSignedUploadUrl(filePath, { upsert: true });

            if (urlError) { 
                console.error(`[startSingleFileUpload - Step 4] Error getting signed URL for ${(currentFileToUpload as File).name}:`, urlError);
                console.error('[startSingleFileUpload - Step 4] Full Signed URL Error Object:', JSON.stringify(urlError, null, 2));
                throw urlError;
            }
            if (!uploadUrlData?.signedUrl) { 
                 console.error(`[startSingleFileUpload - Step 4] No signed URL returned for ${(currentFileToUpload as File).name}. Data received:`, uploadUrlData);
                 throw new Error("Could not get signed upload URL. No URL present in response.");
            }
            console.log(`[startSingleFileUpload - Step 5] Successfully got signed URL for ${(currentFileToUpload as File).name}`);

            const xhr = new XMLHttpRequest();
            // Store XHR - Requires careful state update if we move this logic
            setUploadQueue(prevQueue => prevQueue.map(f => f.id === fileId ? { ...f, xhr: xhr } : f)); 

            console.log(`[startSingleFileUpload - Step 6] Opening XHR PUT for ${(currentFileToUpload as File).name}`);
            xhr.open('PUT', uploadUrlData.signedUrl, true);
            console.log(`[startSingleFileUpload - Step 7] Setting XHR headers for ${(currentFileToUpload as File).name}`);
            xhr.setRequestHeader('Content-Type', (currentFileToUpload as File).type || 'application/octet-stream');

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentage = Math.round((event.loaded * 100) / event.total);
                    setUploadQueue(prevQueue =>
                        prevQueue.map(f => f.id === fileId ? { ...f, progress: percentage } : f)
                    );
                }
            };

            xhr.onload = async () => {
                 // Use functional update to get the latest state
                 setUploadQueue(prevQueue => {
                    const currentFileState = prevQueue.find(f => f.id === fileId);
                    // Exit if cancelled or not found
                    if (!currentFileState || currentFileState.status === 'cancelled') return prevQueue;
                    const currentFile = currentFileState.file;

                    if (xhr.status >= 200 && xhr.status < 300) {
                        console.log(`${currentFile.name} uploaded successfully to storage. File path: ${filePath}`);
                        toast.success(`${currentFile.name} uploaded successfully!`);
                        
                        // --- Update Variation file_path in DB ---
                        updateVariationFilePathMutation.mutate(filePath, {
                            onError: (error) => {
                                // Handle DB update failure specifically
                                console.error(`Failed to update database for ${currentFile.name}:`, error);
                                toast.error(`Upload complete, but failed to update database record for ${currentFile.name}.`);
                                // Keep status as success? Or revert? For now, keep success as file is in storage.
                                // Consider adding a retry mechanism or manual update option later.
                            }
                        });
                        // ------------------------------------------

                        // Return updated state *immediately* for UI feedback
                        return prevQueue.map(f => f.id === fileId ? { ...f, status: 'success', progress: 100, xhr: undefined } : f);
                    } else {
                        console.error(`Upload failed for ${currentFile.name}. Status: ${xhr.status}, Text: ${xhr.statusText}`);
                        toast.error(`Upload failed for ${currentFile.name}.`);
                        // Return updated state
                        return prevQueue.map(f => f.id === fileId ? { ...f, status: 'error', error: `Upload failed: ${xhr.statusText || xhr.status}`, xhr: undefined } : f);
                    }
                 });
                 // Removed await here as the state update needs to happen synchronously for UI
                 // and the mutation handles its own async logic.
            };

            xhr.onerror = () => {
                setUploadQueue(prevQueue => {
                    const currentFileState = prevQueue.find(f => f.id === fileId);
                    // Exit if cancelled or not found
                    if (!currentFileState || currentFileState.status === 'cancelled') return prevQueue; 
                    // Re-get the file object for type safety inside callback
                    const currentFile = currentFileState.file;

                    toast.error(`Network error during upload for ${currentFile.name}.`);
                    return prevQueue.map(f => f.id === fileId ? { ...f, status: 'error', error: 'Network error', xhr: undefined } : f);
                });
            };

            xhr.onabort = () => {
                 console.log(`Upload aborted for file ID: ${fileId}`); 
                 setUploadQueue(prevQueue => prevQueue.map(f => f.id === fileId ? { ...f, status: 'cancelled', progress: 0, xhr: undefined } : f));
            };

            console.log(`[startSingleFileUpload - Step 8] Sending XHR for ${(currentFileToUpload as File).name}`);
            xhr.send(currentFileToUpload);
            console.log(`[startSingleFileUpload - Step 9] XHR send() method called successfully for ${(currentFileToUpload as File).name}`);

        } catch (error: any) {
             console.error(`[startSingleFileUpload - Step CATCH] CRITICAL FAILURE during upload setup for: ${(currentFileToUpload as File)?.name || fileId}`);
             console.error("[startSingleFileUpload - Step CATCH] Error Details:", error);
             const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
             toast.error(`Could not start upload for ${(currentFileToUpload as File)?.name || 'file'}. Error: ${errorMessage}`);
             setUploadQueue(prevQueue => prevQueue.map(f => f.id === fileId ? { ...f, status: 'error', error: `Setup failed: ${errorMessage}`, xhr: undefined } : f));
        }

    }, [supabase, variationId, projectId, designId, versionId, queryClient, updateVariationFilePathMutation]);

    // --- Upload Management Effect (MODIFIED - Step 2) --- 
    useEffect(() => {
        if (!supabase) return; 
        
        const uploadingCount = uploadQueue.filter(f => f.status === 'uploading').length;
        const pendingFiles = uploadQueue.filter(f => f.status === 'pending');
        const slotsAvailable = MAX_CONCURRENT_UPLOADS - uploadingCount;

        if (slotsAvailable > 0 && pendingFiles.length > 0) {
            const filesToMarkUploading = pendingFiles.slice(0, slotsAvailable);
            const filesToMarkIds = filesToMarkUploading.map(f => f.id);
            
            // Update state to mark selected pending files as 'uploading'
            setUploadQueue(currentQueue => 
                currentQueue.map(fileInfo => 
                    filesToMarkIds.includes(fileInfo.id)
                        ? { ...fileInfo, status: 'uploading' } 
                        : fileInfo
                )
            );
            
            // // Original logic removed - we no longer call startSingleFileUpload directly here
            // filesToStart.forEach(fileInfo => {
            //     startSingleFileUpload(fileInfo.id);
            // });
        }
    // Remove startSingleFileUpload from dependencies as it's no longer called here
    }, [uploadQueue, supabase]); 

    // --- New Effect for executing uploads (ADDED - Step 3) --- 
    useEffect(() => {
        // Find files that are marked as 'uploading' but haven't started the XHR process yet
        const filesToActuallyStart = uploadQueue.filter(
            (fileInfo) => fileInfo.status === 'uploading' && fileInfo.xhr === undefined
        );

        if (filesToActuallyStart.length > 0) {
             console.log(`[Upload Trigger Effect] Found ${filesToActuallyStart.length} file(s) marked for upload. Starting them...`);
             filesToActuallyStart.forEach((fileInfo) => {
                // Now call the async function to handle the actual upload
                startSingleFileUpload(fileInfo.id);
            });
        }
    // This effect depends on the queue content and the function to start the upload
    }, [uploadQueue, startSingleFileUpload]);

    // --- Cancel Upload Function ---
     const cancelUpload = useCallback((fileId: string) => {
        setUploadQueue(prevQueue => {
            const fileToCancel = prevQueue.find(f => f.id === fileId);
            if (fileToCancel?.xhr && fileToCancel.status === 'uploading') {
                 console.log(`Attempting to cancel upload for: ${fileToCancel.file.name}`);
                 fileToCancel.xhr.abort(); 
                 toast.info(`Upload for ${fileToCancel.file.name} cancelled.`);
                 // State update is handled by onabort, but set status optimistically
                 return prevQueue.map(f => f.id === fileId ? { ...f, status: 'cancelled', progress: 0 } : f); 
            }
            return prevQueue; 
        });
    }, []);

    // --- Handlers ---
    const handleVariationEditSubmit = (values: VariationEditFormData) => {
        updateVariationMutation.mutate(values, {
            onSuccess: () => {
                setIsEditingVariation(false);
            }
        });
    };

    const handleEnterEditMode = () => {
        if (variation) {
            resetVariationEditForm({
                notes: variation.notes || '',
                status: variation.status,
            });
            setIsEditingVariation(true);
        }
    };

    const handleCancelEditMode = () => {
        setIsEditingVariation(false);
    };

    // Dropzone Handlers
    const onFilesAccepted = useCallback((acceptedFiles: File[]) => {
        console.log('Batch Accepted files:', acceptedFiles);
        const newUploads: UploadingFileInfo[] = acceptedFiles.map(file => ({
            id: `${file.name}-${file.lastModified}-${Math.random()}`,
            file: file,
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
            status: 'pending',
            progress: 0,
        }));
        setUploadQueue(prevQueue => [...prevQueue, ...newUploads]);
    }, []); 

    const onFilesRejected = useCallback((fileRejections: any[]) => {
        console.log('Rejected files:', fileRejections);
        fileRejections.forEach(rejection => {
            const firstError = rejection.errors[0];
            let message = 'Invalid file';
             if (firstError) {
                if (firstError.code === 'file-too-large') {
                    message = `File is too large. Max size is 10MB.`;
                } else if (firstError.code === 'file-invalid-type') {
                    message = `Invalid file type.`;
                } else {
                    message = firstError.message;
                }
            }
            toast.error(`File rejected: ${rejection.file.name} - ${message}`);
        });
    }, []);
    
    // --- Mutations ---
    const updateVariationMutation = useUpdateVariation(variationId); // Keep this for edits

    // File type definitions for Dropzone
    const acceptedFileTypes = {
        'image/jpeg': ['.jpg', '.jpeg'],
        'image/png': ['.png'],
        'image/gif': ['.gif'],
        'image/webp': ['.webp'],
        'image/svg+xml': ['.svg'],
        'application/postscript': ['.ai'], // MIME type for Adobe Illustrator
        'application/photoshop': ['.psd'], // Common (though not official) MIME type
        'image/vnd.adobe.photoshop': ['.psd'] // Another possible PSD MIME type
    };

    // --- Loading & Error States ---
    if (isLoadingProject || isLoadingDesign || isLoadingVersion || isLoadingVariation) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /> Loading Variation Details...</div>;
    }

    if (variationError || !variation) {
        return (
            <div className="container mx-auto p-4">
                <h1 className="text-2xl font-bold text-red-600">Error</h1>
                <p>{variationError ? variationError.message : 'Variation not found.'}</p>
                <Link href={`/projects/${projectId}/designs/${designId}/versions/${versionId}`} className="text-blue-600 hover:underline mt-4 inline-block">
                    Return to Version
                </Link>
            </div>
        );
    }

    // --- Breadcrumbs --- 
    const breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Dashboard', href: '/dashboard' },
        { label: project?.name ?? 'Project', href: `/projects/${projectId}` },
        { label: design?.name ?? 'Design', href: `/projects/${projectId}/designs/${designId}` },
        { label: `V${version?.version_number ?? '?'}`, href: `/projects/${projectId}/designs/${designId}/versions/${versionId}` },
        { label: `Variation ${variation.variation_letter}` } // Current variation page
    ];

    // --- Render --- 
    return (
        <div className="container mx-auto p-4 space-y-6">
            <Breadcrumbs items={breadcrumbItems} />

            {/* --- File Display Area (Always show if path exists) --- */}
            {variation.file_path && (
                <Card>
                    <CardHeader>
                        <CardTitle>Uploaded File</CardTitle>
                         {/* TODO: Add replace/delete file functionality */}
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Display Filename */}
                        <p>
                            Filename:
                            <span className="font-medium ml-2">{getFilenameFromPath(variation.file_path)}</span>
                        </p>

                        {/* Display Image Preview using Signed URL */}
                        {urlLoading && (
                            <div className="flex items-center text-sm text-muted-foreground">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading image preview...
                            </div>
                        )}
                        {urlError && (
                            <p className="text-sm text-red-600">Error loading image: {urlError}</p>
                        )}
                        {imageUrl && !urlLoading && !urlError && (
                            <div className="mt-4 border rounded-lg p-2 max-w-md mx-auto">
                                <img 
                                    src={imageUrl} 
                                    alt={`Preview for ${getFilenameFromPath(variation.file_path)}`} 
                                    className="max-w-full h-auto object-contain rounded-lg"
                                />
                            </div>
                        )}
                        {/* TODO: Consider adding a download button using the signedUrl */}
                    </CardContent>
                </Card>
            )}

            {/* --- Upload Area (Now handles queue) --- */}
            <Card>
                <CardHeader>
                    <CardTitle>Upload New Design Files</CardTitle>
                    <CardDescription>Upload design file(s) for this variation. (Max 10MB each)</CardDescription>
                </CardHeader>
                <CardContent>
                    <Dropzone
                        onFilesAccepted={onFilesAccepted} 
                        onFilesRejected={onFilesRejected} 
                        accept={acceptedFileTypes}      
                        maxSize={10 * 1024 * 1024}      
                        multiple={true} // Allow multiple
                        className="mb-4"
                        disabled={uploadQueue.filter(f => f.status === 'uploading' || f.status === 'pending').length >= 5} // Limit queue size
                    />
                    
                    {/* Display Upload Queue & Progress */}
                    {uploadQueue.length > 0 && (
                        <div className="mt-4 space-y-3">
                            <h4 className="text-sm font-medium mb-2">Upload Queue:</h4>
                            {uploadQueue.map((fileInfo) => (
                                <div key={fileInfo.id} className="text-sm border p-3 rounded-md space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            {fileInfo.previewUrl ? (
                                                <img 
                                                    src={fileInfo.previewUrl} 
                                                    alt={`Preview of ${fileInfo.file.name}`} 
                                                    className="h-10 w-10 object-contain border rounded-lg flex-shrink-0" 
                                                />
                                            ) : (
                                                <div className="h-10 w-10 flex items-center justify-center border rounded-lg bg-muted text-muted-foreground text-xs flex-shrink-0">
                                                    No Preview
                                                </div>
                                            )}
                                            <span className="truncate" title={fileInfo.file.name}>
                                                {fileInfo.file.name} ({(fileInfo.file.size / 1024).toFixed(2)} KB)
                                            </span>
                                        </div>
                                        {/* Cancel Button */} 
                                        {(fileInfo.status === 'uploading' || fileInfo.status === 'pending') && (
                                            <Button 
                                                size="icon" 
                                                variant="ghost" 
                                                onClick={() => cancelUpload(fileInfo.id)} 
                                                title={fileInfo.status === 'uploading' ? "Cancel Upload" : "Remove from Queue"} // Adjust title/action
                                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                            >
                                                <X className="h-4 w-4"/>
                                            </Button>
                                        )}
                                     </div>
                                     {/* Status Text */} 
                                     <p className={`text-xs ${fileInfo.status === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>
                                        Status: {fileInfo.status} {fileInfo.status === 'uploading' ? `(${fileInfo.progress}%)` : ''}
                                     </p>
                                     {/* Progress Bar */} 
                                     {fileInfo.status === 'uploading' && (
                                         <Progress value={fileInfo.progress} className="h-1" />
                                     )}
                                     {/* Error Message */} 
                                     {fileInfo.status === 'error' && (
                                         <p className="text-xs text-red-600">Error: {fileInfo.error}</p>
                                     )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
            
            {/* --- Variation Details & Feedback Card --- */}
            <Card>
                <CardHeader>
                     <div className="flex justify-between items-start gap-4">
                        <div>
                            <CardTitle className="text-2xl mb-1">Variation {variation.variation_letter}</CardTitle>
                            <CardDescription>Details and feedback for this variation.</CardDescription>
                        </div>
                        {!isEditingVariation && (
                            <Button variant="outline" size="sm" onClick={handleEnterEditMode}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit Variation
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {isEditingVariation ? (
                        <form onSubmit={handleSubmitVariationEdit(handleVariationEditSubmit)} className="space-y-4 mb-6">
                            {/* Status Select */}
                            <div className="space-y-1">
                                <Label htmlFor="status">Status</Label>
                                 <Controller
                                    name="status"
                                    control={variationEditControl}
                                    render={({ field }) => (
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <SelectTrigger id="status">
                                                <SelectValue placeholder="Select status..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {variationFeedbackStatuses.map((status) => (
                                                    <SelectItem key={status} value={status}>
                                                        {status}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                                 {variationEditFormErrors.status && <p className="text-sm text-red-600">{variationEditFormErrors.status.message}</p>}
                            </div>

                            {/* Notes Textarea */}
                            <div className="space-y-1">
                                <Label htmlFor="notes">Notes</Label>
                                <Textarea
                                    id="notes"
                                    placeholder="Add any notes relevant to this variation..."
                                    {...registerVariationEdit("notes")}
                                    rows={3}
                                />
                                {variationEditFormErrors.notes && <p className="text-sm text-red-600">{variationEditFormErrors.notes.message}</p>}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-end space-x-2 pt-2">
                                 <Button type="button" variant="outline" onClick={handleCancelEditMode} disabled={isSubmittingVariationEdit}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={isSubmittingVariationEdit || updateVariationMutation.isPending}>
                                    {(isSubmittingVariationEdit || updateVariationMutation.isPending) && (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    Save Changes
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <div className="space-y-2 mb-4">
                             <p><strong>Status:</strong> <Badge variant="secondary">{variation.status}</Badge></p>
                             <p><strong>Notes:</strong> {variation.notes || <span className="text-muted-foreground">No notes added.</span>}</p>
                             <p className="text-sm text-muted-foreground">Created: {new Date(variation.created_at).toLocaleDateString()}</p>
                        </div>
                   )}

                    {/* Placeholder for Feedback Section */}
                    <div className="mt-6 border-t pt-4">
                        <h3 className="text-lg font-semibold mb-2">Feedback</h3>
                        <p className="italic text-muted-foreground">Feedback/comments section will go here.</p>
                        {/* TODO: Implement feedback system (Task 6 & 7) */}
                    </div>
                </CardContent>
            </Card>

        </div>
    );
} 