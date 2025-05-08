// Trivial change to trigger Vercel redeploy
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { toast } from 'sonner';
import { 
    Design, 
    DesignStage, 
    VariationFeedbackStatus,
    Version,
    Variation,
    Comment,
    Attachment,
    UploadingFileInfo
} from '@/types/models';
import { 
    THUMBNAIL_WIDTH, 
    MEDIUM_WIDTH, 
    LARGE_WIDTH 
} from '@/lib/constants/imageConstants'; // Import width constants

// --- Version Mutations ---
export const useUpdateVersionDetails = (versionId: string, designId: string, projectId: string | null) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ stage, status }: { stage?: DesignStage; status?: string }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!versionId) throw new Error("Version ID is required");

            const updateData: { stage?: DesignStage; status?: string; updated_at: string } = {
                updated_at: new Date().toISOString()
            };
            if (stage !== undefined) updateData.stage = stage;
            if (status !== undefined) updateData.status = status;

            const { data, error } = await supabase
                .from('versions')
                .update(updateData)
                .eq('id', versionId)
                .select()
                .single();

            if (error) {
                console.error('Error updating version details:', error);
                throw new Error(`Failed to update version details: ${error.message}`);
            }
            return data;
        },
        onSuccess: () => {
            toast.success('Version details updated successfully!');
            // Invalidate relevant queries
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
            if (projectId) {
                queryClient.invalidateQueries({ queryKey: ['designs', projectId] });
            }
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// Modify hook signature and implementation
export const useAddVersionWithVariations = (
    designId: string,
    projectId: string,
    setCurrentVersionId: (id: string) => void,
    setCurrentVariationId: (id: string) => void,
    setUploadQueue: React.Dispatch<React.SetStateAction<UploadingFileInfo[]>> // Add parameter
) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();
    const BUCKET_NAME = 'design-variations'; // Define bucket name
    const CONCURRENCY_LIMIT = 3; // Restore concurrency limit

    return useMutation({
        mutationFn: async ({ files }: { files: File[] }) => {
            // Removed entry log
            if (!supabase) throw new Error("Supabase client not available");
            if (!designId) throw new Error("Design ID is required");
            if (!files || files.length === 0) throw new Error("No files provided");

            // --- 1. Get the latest version number ---
            const { data: versions, error: versionsError } = await supabase
                .from('versions')
                .select('version_number')
                .eq('design_id', designId)
                .order('version_number', { ascending: false })
                .limit(1);

            if (versionsError) throw new Error(`Failed to get latest version number: ${versionsError.message}`);
            const nextVersionNumber = versions && versions.length > 0 ? versions[0].version_number + 1 : 1;

            // --- 2. Create new version record ---
            const { data: newVersion, error: versionError } = await supabase
                .from('versions')
                .insert({
                    design_id: designId,
                    version_number: nextVersionNumber,
                    status: 'Work in Progress',
                    stage: DesignStage.Sketch
                })
                .select()
                .single();

            if (versionError || !newVersion) {
                throw new Error(`Failed to create version: ${versionError?.message || 'Unknown error'}`);
            }

            // --- 3. Sequentially create all variation DB records ---
            const createdVariations: Variation[] = [];
            try {
            for (let i = 0; i < files.length; i++) {
                    const variationLetter = String.fromCharCode(65 + i); // 'A', 'B', 'C', ...
                    const { data: createdVar, error: variationCreateError } = await supabase
                    .from('variations')
                        .insert({ version_id: newVersion.id, variation_letter: variationLetter, status: VariationFeedbackStatus.PendingFeedback })
                    .select()
                    .single();

                    if (variationCreateError || !createdVar) {
                        // If creating a record fails, we should ideally roll back or mark the version as failed
                        throw new Error(`Failed to create DB record for variation ${variationLetter}: ${variationCreateError?.message}`);
                    }
                    createdVariations.push(createdVar);
                }
            } catch (error: unknown) {
                 // Clean up already created version if variation creation fails? Or let user handle it?
                 // For now, just re-throw
                 console.error("Error during sequential variation record creation:", error);
                 // Optionally delete the version created above before throwing
                 // await supabase.from('versions').delete().eq('id', newVersion.id); 
                 throw error; 
            }

            // --- 4. Concurrently upload files and update records ---
            const results: PromiseSettledResult<Variation>[] = []; // Keep for consistency, but populated differently
            const allUploadPromises: Promise<Variation>[] = []; // Store all raw promises
            let activePromises: Promise<unknown>[] = [];

            const processFileUploadAndUpdate = async (file: File, variationRecord: Variation): Promise<Variation> => {
                const fileId = `${variationRecord.version_id}-${variationRecord.variation_letter}-${Date.now()}`;
                let finalFilePath = '';
                const previewUrl = URL.createObjectURL(file); // Create preview URL

                // Add to queue immediately
                setUploadQueue(prev => [
                    ...prev, 
                    { id: fileId, file, previewUrl, status: 'pending', progress: 0, uploadStarted: false, xhr: undefined }
                ]);

                try {
                    // a. Prepare for Upload
                    finalFilePath = `projects/${projectId}/designs/${designId}/versions/${variationRecord.version_id}/variations/${variationRecord.id}/${file.name}`;
                    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
                        .from(BUCKET_NAME)
                        .createSignedUploadUrl(finalFilePath);

                    if (signedUrlError || !signedUrlData?.signedUrl) {
                        throw new Error(`Failed to get signed upload URL for ${variationRecord.variation_letter}: ${signedUrlError?.message || 'No URL returned'}`);
                    }
                    const signedUrl = signedUrlData.signedUrl;

                    // b. Perform XHR Upload with Progress
                    await new Promise<void>((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        setUploadQueue(prev => prev.map(f => f.id === fileId ? { ...f, xhr: xhr, status: 'uploading', uploadStarted: true, progress: 0 } : f));

                        xhr.open('PUT', signedUrl, true);
                        xhr.setRequestHeader('Content-Type', file.type);

                        xhr.upload.onprogress = (event) => {
                            if (event.lengthComputable) {
                                const progress = Math.round((event.loaded / event.total) * 100);
                                setUploadQueue(prev => prev.map(f => f.id === fileId ? { ...f, progress: progress } : f));
                            }
                        };
                        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Storage upload failed: ${xhr.statusText || 'XHR Error'} (Status ${xhr.status})`));
                        xhr.onerror = () => reject(new Error('Storage upload failed: Network error'));
                        xhr.onabort = () => {
                            setUploadQueue(prev => prev.map(f => f.id === fileId ? { ...f, status: 'cancelled', progress: 0 } : f));
                            reject(new Error('Upload cancelled')); // Treat abort as an error for the promise chain
                        };
                        xhr.send(file);
                    });

                    // c. Update Variation Record with File Path
                const { data: updatedVariation, error: updateError } = await supabase
                    .from('variations')
                        .update({ file_path: finalFilePath, updated_at: new Date().toISOString() })
                        .eq('id', variationRecord.id)
                    .select()
                    .single();

                    if (updateError || !updatedVariation) {
                        throw new Error(`Failed to link file path for variation ${variationRecord.variation_letter}: ${updateError?.message}`);
                    }

                    // --- ADDED: Trigger Image Processing API for this successfully uploaded variation ---
                    console.log(`[AddVersion] Triggering image processing for: ${finalFilePath}`);
                    try {
                        const processResponse = await fetch('/api/process-image', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ originalPath: finalFilePath }),
                        });
                        if (!processResponse.ok) {
                            const errorBody = await processResponse.json().catch(() => ({ error: 'Image processing API request failed with status ' + processResponse.status }));
                            console.error(`[AddVersion] Image processing API call failed for ${finalFilePath}. Status: ${processResponse.status}`, errorBody);
                            // Non-fatal: Log a warning toast, but the main upload was successful.
                            toast.warning(`Variation ${variationRecord.variation_letter} uploaded, but processing failed: ${errorBody.error || 'Unknown error'}`);
                        } else {
                            console.log(`[AddVersion] Image processing API call successful for ${finalFilePath}`);
                        }
                    } catch (processError) {
                        console.error(`[AddVersion] Error calling image processing API for ${finalFilePath}:`, processError);
                        toast.warning(`Variation ${variationRecord.variation_letter} uploaded, but an error occurred while triggering processing: ${processError instanceof Error ? processError.message : 'Unknown error'}`);
                    }
                    // --- END: Trigger Image Processing ---

                    // d. Success for this file: Remove from queue and return result
                    setUploadQueue(prev => prev.filter(f => f.id !== fileId)); 
                    URL.revokeObjectURL(previewUrl); // Clean up blob URL
                    return updatedVariation;

                } catch (error: unknown) {
                    console.error(`[AddVersion] Failed processing upload/update for variation ${variationRecord.variation_letter}:`, error);
                    setUploadQueue(prev => prev.map(f => 
                        f.id === fileId ? { ...f, status: 'error', error: error as string || 'Processing failed', progress: 0 } : f
                    ));
                    URL.revokeObjectURL(previewUrl); // Clean up blob URL even on error
                    throw error; // Re-throw to be caught by the concurrency controller
                }
            };

            // Concurrency Management Loop
            const fileIterator = files.entries(); 
            let currentFileJobIndex = 0; 
            let nextFileJob = fileIterator.next();

            while (currentFileJobIndex < files.length || activePromises.length > 0) {
                while (activePromises.length < CONCURRENCY_LIMIT && !nextFileJob.done) {
                    const [originalIndex, fileToProcess] = nextFileJob.value;
                    const correspondingVariation = createdVariations[originalIndex]; 

                    if (!correspondingVariation) {
                        console.error(`Consistency error: No pre-created variation found for file index ${originalIndex}`);
                        // Handle error: maybe push a rejected result immediately
                        currentFileJobIndex++;
                        nextFileJob = fileIterator.next();
                        continue; 
                    }

                    // Create the promise
                    const uploadPromise = processFileUploadAndUpdate(fileToProcess, correspondingVariation);
                    allUploadPromises.push(uploadPromise); // Store the raw promise
                    
                    // Create a wrapped promise *only* for managing active slots
                    const wrappedPromise = uploadPromise
                        .catch(() => {}) // Prevent unhandled rejection for the wrapper
                        .finally(() => {
                            activePromises = activePromises.filter(p => p !== wrappedPromise);
                        });
                    activePromises.push(wrappedPromise);

                    currentFileJobIndex++;
                    nextFileJob = fileIterator.next();
                }

                if (activePromises.length > 0) {
                     // Wait for *any* active promise to finish to free up a slot
                     // We don't need to collect results here anymore
                    await Promise.race(activePromises);
                } else {
                    // Exit loop if no more files to start and no promises are active
                    break; 
                }
            }

            // --- 5. Wait for all uploads and process results ---
            const finalResults = await Promise.allSettled(allUploadPromises);

            const successfulVariations = finalResults
                .filter((result): result is PromiseFulfilledResult<Variation> => result.status === 'fulfilled')
                .map(result => result.value);
            
            const failedCount = finalResults.length - successfulVariations.length;
            // Corrected failed count calculation
            console.log(`[AddVersion] Finished processing batch. Success: ${successfulVariations.length}, Failed: ${failedCount}`);

            // Return the new version and successfully processed variations
            return { version: newVersion, variations: successfulVariations }; 
        },
        onSuccess: (data) => {
            // Only remove successfully processed items from queue (error items stay)
            // Success is now handled inside processFileUploadAndUpdate
            
            toast.success(`Version ${data.version.version_number} created. ${data.variations.length} variation(s) processed successfully.`);
            setCurrentVersionId(data.version.id);
            if (data.variations.length > 0) {
                 // Sort variations by letter before picking the first one?
                 const sortedVariations = [...data.variations].sort((a, b) => a.variation_letter.localeCompare(b.variation_letter));
                 setCurrentVariationId(sortedVariations[0].id);
            }
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
            queryClient.invalidateQueries({ queryKey: ['designs', projectId] });
        },
        onError: (error: Error) => {
            // Catches errors from initial version creation or sequential variation creation
            toast.error(`Failed to add version: ${error.message}`);
             // Cleanup logic for queue items might be needed if error occurred before loop start
             // For now, rely on individual errors set in processFileUploadAndUpdate
        },
    });
};

// Refactored hook for adding variations with queue integration
export const useAddVariationsToVersion = (
    versionId: string, 
    designId: string, 
    projectId: string,
    setUploadQueue: React.Dispatch<React.SetStateAction<UploadingFileInfo[]>> // Add setUploadQueue
) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();
    const BUCKET_NAME = 'design-variations';
    const CONCURRENCY_LIMIT = 3; // Restore concurrency limit

    return useMutation({
        mutationFn: async ({ files }: { files: File[] }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!versionId) throw new Error("Version ID is required");
            if (!files || files.length === 0) return { addedVariations: [] }; // Return early if no files

            // --- 1. Get the current highest variation letter ---
            const { data: existingVariations, error: fetchError } = await supabase
                .from('variations')
                .select('variation_letter')
                .eq('version_id', versionId)
                .order('variation_letter', { ascending: false });

            if (fetchError) {
                throw new Error(`Failed to fetch existing variations: ${fetchError.message}`);
            }

            let nextLetterCode = 65; // Start at 'A'
            if (existingVariations && existingVariations.length > 0) {
                const highestLetter = existingVariations[0].variation_letter;
                nextLetterCode = highestLetter.charCodeAt(0) + 1;
            }

            // --- 2. Sequentially create all new variation DB records ---
            const createdVariations: Variation[] = [];
            try {
                for (let i = 0; i < files.length; i++) {
                    const variationLetter = String.fromCharCode(nextLetterCode + i);
                    const { data: createdVar, error: variationCreateError } = await supabase
                    .from('variations')
                        .insert({ version_id: versionId, variation_letter: variationLetter, status: VariationFeedbackStatus.PendingFeedback })
                    .select()
                    .single();

                    if (variationCreateError || !createdVar) {
                        throw new Error(`Failed to create DB record for variation ${variationLetter}: ${variationCreateError?.message}`);
                    }
                    createdVariations.push(createdVar);
                }
            } catch (error: unknown) {
                 console.error("[AddVarUpload] Error during sequential variation record creation:", error);
                 // Unlike creating a new version, we don't necessarily need to clean up here,
                 // as the version already exists. Just re-throw.
                 throw error; 
            }

            // --- 3. Define the upload and update function ---
            const processFileUploadAndUpdate = async (file: File, variationRecord: Variation): Promise<Variation> => {
                const fileId = `${variationRecord.version_id}-${variationRecord.variation_letter}-${Date.now()}`;
                let finalFilePath = '';
                const previewUrl = URL.createObjectURL(file);

                setUploadQueue(prev => [
                    ...prev, 
                    { id: fileId, file, previewUrl, status: 'pending', progress: 0, uploadStarted: false, xhr: undefined }
                ]);

                try {
                    // a. Prepare Upload Path & URL
                    finalFilePath = `projects/${projectId}/designs/${designId}/versions/${versionId}/variations/${variationRecord.id}/${file.name}`;
                    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
                        .from(BUCKET_NAME)
                        .createSignedUploadUrl(finalFilePath);
                    if (signedUrlError || !signedUrlData?.signedUrl) {
                        throw new Error(`Failed to get signed URL for ${variationRecord.variation_letter}: ${signedUrlError?.message || 'No URL'}`);
                    }
                    const signedUrl = signedUrlData.signedUrl;

                    // b. XHR Upload
                    await new Promise<void>((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        setUploadQueue(prev => prev.map(f => f.id === fileId ? { ...f, xhr: xhr, status: 'uploading', uploadStarted: true, progress: 0 } : f));
                        xhr.open('PUT', signedUrl, true);
                        xhr.setRequestHeader('Content-Type', file.type);
                        xhr.upload.onprogress = (event) => {
                            if (event.lengthComputable) {
                                const progress = Math.round((event.loaded / event.total) * 100);
                                setUploadQueue(prev => prev.map(f => f.id === fileId ? { ...f, progress: progress } : f));
                            }
                        };
                        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Storage upload failed: Status ${xhr.status}`));
                        xhr.onerror = () => reject(new Error('Storage upload failed: Network error'));
                        xhr.onabort = () => reject(new Error('Upload cancelled'));
                        xhr.send(file);
                    });

                    // c. Update Variation Record
                const { data: updatedVariation, error: updateError } = await supabase
                    .from('variations')
                        .update({ file_path: finalFilePath })
                        .eq('id', variationRecord.id)
                    .select()
                    .single();
                    if (updateError || !updatedVariation) {
                        throw new Error(`Failed to link file path for ${variationRecord.variation_letter}: ${updateError?.message}`);
                    }

                    // --- ADDED: Trigger Image Processing API for this successfully uploaded variation ---
                    console.log(`[AddVarUpload] Triggering image processing for: ${finalFilePath}`);
                    try {
                        const processResponse = await fetch('/api/process-image', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ originalPath: finalFilePath }),
                        });
                        if (!processResponse.ok) {
                            const errorBody = await processResponse.json().catch(() => ({ error: 'Image processing API request failed with status ' + processResponse.status }));
                            console.error(`[AddVarUpload] Image processing API call failed for ${finalFilePath}. Status: ${processResponse.status}`, errorBody);
                            // Non-fatal: Log a warning toast, but the main upload was successful.
                            toast.warning(`Variation ${variationRecord.variation_letter} uploaded, but processing failed: ${errorBody.error || 'Unknown error'}`);
                        } else {
                            console.log(`[AddVarUpload] Image processing API call successful for ${finalFilePath}`);
                        }
                    } catch (processError) {
                        console.error(`[AddVarUpload] Error calling image processing API for ${finalFilePath}:`, processError);
                        toast.warning(`Variation ${variationRecord.variation_letter} uploaded, but an error occurred while triggering processing: ${processError instanceof Error ? processError.message : 'Unknown error'}`);
                    }
                    // --- END: Trigger Image Processing ---

                    // d. Success
                    setUploadQueue(prev => prev.filter(f => f.id !== fileId)); 
                    URL.revokeObjectURL(previewUrl);
                    return updatedVariation;

                } catch (error: unknown) {
                    console.error(`[AddVarUpload] Failed processing ${variationRecord.variation_letter}:`, error);
                    setUploadQueue(prev => prev.map(f => 
                        f.id === fileId ? { ...f, status: 'error', error: error as string || 'Failed', progress: 0 } : f
                    ));
                    URL.revokeObjectURL(previewUrl);
                    throw error;
                }
            };

            // --- 4. Concurrency Management Loop ---
            const allUploadPromises: Promise<Variation>[] = [];
            let activePromises: Promise<unknown>[] = [];
            const fileIterator = files.entries();
            let currentFileJobIndex = 0;
            let nextFileJob = fileIterator.next();

            while (currentFileJobIndex < files.length || activePromises.length > 0) {
                while (activePromises.length < CONCURRENCY_LIMIT && !nextFileJob.done) {
                    const [originalIndex, fileToProcess] = nextFileJob.value;
                    // Use the index relative to the *newly created* variations array
                    const correspondingVariation = createdVariations[originalIndex]; 

                    if (!correspondingVariation) {
                        console.error(`Consistency error: No pre-created variation found for file index ${originalIndex}`);
                        currentFileJobIndex++;
                        nextFileJob = fileIterator.next();
                        continue; 
                    }

                    const uploadPromise = processFileUploadAndUpdate(fileToProcess, correspondingVariation);
                    allUploadPromises.push(uploadPromise);

                    const wrappedPromise = uploadPromise
                        .catch(() => {}) 
                        .finally(() => {
                            activePromises = activePromises.filter(p => p !== wrappedPromise);
                        });
                    activePromises.push(wrappedPromise);

                    currentFileJobIndex++;
                    nextFileJob = fileIterator.next();
                }

                if (activePromises.length > 0) {
                    await Promise.race(activePromises);
                } else {
                    break;
                }
            }

            // --- 5. Wait for all uploads and process results ---
            const finalResults = await Promise.allSettled(allUploadPromises);

            const successfulVariations = finalResults
                .filter((result): result is PromiseFulfilledResult<Variation> => result.status === 'fulfilled')
                .map(result => result.value);
            
            const failedCount = files.length - successfulVariations.length;
            console.log(`[AddVarUpload] Finished. Success: ${successfulVariations.length}, Failed: ${failedCount}`);

            return { addedVariations: successfulVariations };
        },
        onSuccess: (data, variables) => {
            const successCount = data.addedVariations.length;
            const totalAttempted = variables.files.length;
            if (successCount > 0) {
                 toast.success(`Successfully added ${successCount} of ${totalAttempted} variation(s).`);
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
                 if (projectId) {
                     queryClient.invalidateQueries({ queryKey: ['designs', projectId] });
                 }
            } else if (totalAttempted > 0) { // Only show error if files were attempted
                 toast.error(`Failed to add ${totalAttempted} variation(s). Check queue for errors.`);
            } // If totalAttempted is 0, do nothing.
            // Successful uploads are removed from queue inside processFileUploadAndUpdate
        },
        onError: (error: Error, variables) => {
            // Catches errors from initial fetch or sequential creation phase
            toast.error(`Failed to add variations: ${error.message}`);
            console.error("[AddVarUpload] Global mutation error:", error);
            // Potentially mark related queue items as error? Difficult without IDs yet.
        },
    });
};

// Helper function (similar to edge function, but simplified for client-side use)
// Gets the BASE name without extension or _WIDTH suffix
const getBaseFileName = (filePath: string | null | undefined): string => {
    if (!filePath) return '';
    const parts = filePath.split('/');
    const fileNameWithAnyExt = parts.pop() || '';
    const fileNameWithoutAnyExt = fileNameWithAnyExt.split('.').slice(0, -1).join('.');
    return fileNameWithoutAnyExt.replace(/_\d+$/, ''); 
};

// --- Delete Variation Hook ---
// MODIFIED: To include storage file deletion
export const useDeleteVariation = (variationId: string, designId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();
    const DESIGN_VARIATIONS_BUCKET = 'design-variations';
    const PROCESSED_IMAGES_BUCKET = 'processed-images'; // Use correct bucket name

    return useMutation({
        mutationFn: async () => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Variation ID is required");

            let originalFilePath: string | null = null;

            // 1. Fetch the file_path BEFORE deleting the DB record
            try {
                const { data: variationData, error: fetchError } = await supabase
                    .from('variations')
                    .select('file_path')
                    .eq('id', variationId)
                    .single();

                if (fetchError && fetchError.code !== 'PGRST116') { // Ignore 'not found' errors
                    console.error(`[DeleteVar] Error fetching file_path for ${variationId}:`, fetchError);
                    // Decide if we should proceed or throw. Let's proceed but log.
                } else if (variationData) {
                    originalFilePath = variationData.file_path;
                    console.log(`[DeleteVar] Found file_path for ${variationId}: ${originalFilePath}`);
                }
            } catch (error) {
                console.error(`[DeleteVar] Exception fetching file_path for ${variationId}:`, error);
                // Decide if we should proceed or throw. Let's proceed but log.
            }

            // 2. Delete the Variation record from the database
            const { error: deleteDbError } = await supabase
                .from('variations')
                .delete()
                .eq('id', variationId);

            if (deleteDbError) {
                console.error(`[DeleteVar] Error deleting variation record ${variationId}:`, deleteDbError);
                throw new Error(`Failed to delete variation record: ${deleteDbError.message}`);
            }

            console.log(`[DeleteVar] Successfully deleted variation record ${variationId}`);

            // 3. If file_path existed, attempt to delete storage files AFTER successful DB delete
            if (originalFilePath) {
                try {
                    const baseFileName = getBaseFileName(originalFilePath);
                    const originalPathParts = originalFilePath.split('/');
                    originalPathParts.pop(); // Remove original filename
                    const basePath = originalPathParts.join('/');
                    
                    const pathsToDeleteProcessed: string[] = [
                        `${basePath}/${baseFileName}_${THUMBNAIL_WIDTH}.webp`,
                        `${basePath}/${baseFileName}_${MEDIUM_WIDTH}.webp`,
                        `${basePath}/${baseFileName}_${LARGE_WIDTH}.webp`
                    ];
                    const pathsToDeleteOriginal: string[] = [originalFilePath];

                    console.log(`[DeleteVar] Attempting to delete original file:`, pathsToDeleteOriginal);
                    const { error: deleteOriginalError } = await supabase.storage
                        .from(DESIGN_VARIATIONS_BUCKET)
                        .remove(pathsToDeleteOriginal);

                    if (deleteOriginalError) {
                        // Log error but don't throw, DB delete was the primary goal
                        console.error(`[DeleteVar] Failed to delete original file ${originalFilePath}:`, deleteOriginalError);
                        toast.warning(`Variation record deleted, but failed to delete original storage file. Please check storage.`);
                    } else {
                        console.log(`[DeleteVar] Successfully deleted original file ${originalFilePath}`);
                    }
                    
                    console.log(`[DeleteVar] Attempting to delete processed files:`, pathsToDeleteProcessed);
                    const { error: deleteProcessedError } = await supabase.storage
                        .from(PROCESSED_IMAGES_BUCKET)
                        .remove(pathsToDeleteProcessed);

                    if (deleteProcessedError) {
                        // Log error but don't throw
                        console.error(`[DeleteVar] Failed to delete processed files for ${originalFilePath}:`, deleteProcessedError);
                        toast.warning(`Variation record deleted, but failed to delete processed image files. Please check storage.`);
                    } else {
                        console.log(`[DeleteVar] Successfully deleted processed files for ${originalFilePath}`);
                    }

                } catch (storageError) {
                    console.error(`[DeleteVar] Exception during storage file deletion for ${originalFilePath}:`, storageError);
                    toast.warning(`Variation record deleted, but encountered an error during storage cleanup.`);
                }
            } else {
                console.log(`[DeleteVar] No file_path found for variation ${variationId}, skipping storage deletion.`);
            }
            
            // Return something if needed, maybe true for success?
            return true; 
        },
        onSuccess: () => {
            toast.success("Variation deleted successfully!");
            // Invalidate queries to refetch updated data
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
            // Also invalidate the main designs grid query, as the thumbnail might change
            // Find the projectId - how? We don't have it directly here. 
            // We might need to pass projectId to the hook if we want to invalidate the grid.
            // For now, just invalidate the details view.
            // queryClient.invalidateQueries({ queryKey: ['designs', projectId] }); 
            console.log("[DeleteVar] Invalidated designDetails query for:", designId);
        },
        onError: (error: Error) => {
            toast.error(`Failed to delete variation: ${error.message}`);
        },
    });
};

export const useReplaceVariationFile = (variationId: string, designId: string, projectId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ file }: { file: File }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Variation ID is required");

            // Get current variation data
            const { data: variation, error: getError } = await supabase
                .from('variations')
                .select('*, versions!inner(*)')
                .eq('id', variationId)
                .single();

            if (getError || !variation) {
                throw new Error(`Failed to get variation data: ${getError?.message}`);
            }

            // Upload new file
            const filePath = `projects/${projectId}/designs/${designId}/versions/${variation.versions.id}/variations/${variationId}/${file.name}`;
            const { error: uploadError } = await supabase.storage
                .from('design-variations')
                .upload(filePath, file, { upsert: true });

            if (uploadError) {
                throw new Error(`Failed to upload new file: ${uploadError.message}`);
            }

            // Update variation with new file path
            const { data: updatedVariation, error: updateError } = await supabase
                .from('variations')
                .update({ 
                    file_path: filePath,
                    updated_at: new Date().toISOString()
                })
                .eq('id', variationId)
                .select()
                .single();

            if (updateError) {
                throw new Error(`Failed to update variation with new file path: ${updateError.message}`);
            }

            // --- ADDED: Trigger Image Processing API for the replaced file ---
            console.log(`[ReplaceVar] Triggering image processing for: ${filePath}`);
            try {
                const processResponse = await fetch('/api/process-image', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ originalPath: filePath }),
                });
                if (!processResponse.ok) {
                    const errorBody = await processResponse.json().catch(() => ({ error: 'Image processing API request failed with status ' + processResponse.status }));
                    console.error(`[ReplaceVar] Image processing API call failed for ${filePath}. Status: ${processResponse.status}`, errorBody);
                    toast.warning(`File replaced, but processing failed: ${errorBody.error || 'Unknown error'}`);
                } else {
                    console.log(`[ReplaceVar] Image processing API call successful for ${filePath}`);
                }
            } catch (processError) {
                console.error(`[ReplaceVar] Error calling image processing API for ${filePath}:`, processError);
                toast.warning(`File replaced, but an error occurred while triggering processing: ${processError instanceof Error ? processError.message : 'Unknown error'}`);
            }
            // --- END: Trigger Image Processing ---

            return updatedVariation;
        },
        onSuccess: () => {
            toast.success('Variation file replaced successfully!');
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

export const useUpdateVariationDetails = (variationId: string, designId: string, projectId: string | null) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ status }: { status: VariationFeedbackStatus }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Variation ID is required");

            const { data, error } = await supabase
                .from('variations')
                .update({ 
                    status,
                    updated_at: new Date().toISOString()
                })
                .eq('id', variationId)
                .select()
                .single();

            if (error) {
                throw new Error(`Failed to update variation: ${error.message}`);
            }

            return data;
        },
        onSuccess: (data) => {
            toast.success(`Variation status updated to ${data.status}!`);
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
            if (projectId) {
                queryClient.invalidateQueries({ queryKey: ['designs', projectId] });
            }
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- Design Mutations ---
export const useUpdateDesignDetails = (projectId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ designId, name }: { designId: string; name: string }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!designId) throw new Error("Design ID is required");
            if (!name.trim()) throw new Error("Design name cannot be empty");

            const { data, error } = await supabase
                .from('designs')
                .update({ 
                    name: name.trim(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', designId)
                .select()
                .single();

            if (error) {
                throw new Error(`Failed to update design: ${error.message}`);
            }

            return data;
        },
        onSuccess: (data) => {
            toast.success(`Design "${data.name}" updated successfully!`);
            queryClient.invalidateQueries({ queryKey: ['designs', projectId] });
            queryClient.invalidateQueries({ queryKey: ['designDetails', data.id] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

export const useDeleteDesign = (projectId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (designId: string) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!designId) throw new Error("Design ID is required");

            // Delete design record (cascading deletes handled by DB)
            const { error } = await supabase
                .from('designs')
                .delete()
                .eq('id', designId);

            if (error) {
                throw new Error(`Failed to delete design: ${error.message}`);
            }

            return designId;
        },
        onSuccess: (designId) => {
            toast.success('Design deleted successfully!');
            queryClient.invalidateQueries({ queryKey: ['designs', projectId] });
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- Project Mutations ---
export const useDeleteProject = () => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (projectId: string) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!projectId) throw new Error("Project ID is required");

            // Delete project record (cascading deletes handled by DB)
            const { error } = await supabase
                .from('projects')
                .delete()
                .eq('id', projectId);

            if (error) {
                throw new Error(`Failed to delete project: ${error.message}`);
            }

            return projectId;
        },
        onSuccess: (projectId) => {
            toast.success('Project deleted successfully!');
            queryClient.invalidateQueries({ queryKey: ['projects', 'all'] });
            queryClient.invalidateQueries({ queryKey: ['project', projectId] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

export const useSetProjectArchivedStatus = () => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ projectId, is_archived }: { projectId: string; is_archived: boolean }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!projectId) throw new Error("Project ID is required");

            const { data, error } = await supabase
                .from('projects')
                .update({ 
                    is_archived,
                    updated_at: new Date().toISOString()
                })
                .eq('id', projectId)
                .select()
                .single();

            if (error) {
                throw new Error(`Failed to update project archived status: ${error.message}`);
            }

            return data;
        },
        onSuccess: (data) => {
            const action = data.is_archived ? 'archived' : 'unarchived';
            toast.success(`Project "${data.name}" ${action} successfully!`);
            queryClient.invalidateQueries({ queryKey: ['projects', 'all'] });
            queryClient.invalidateQueries({ queryKey: ['project', data.id] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- Comment Mutations ---
export const useAddComment = (designId: string | null, variationId: string | null) => {
    const { supabase, user } = useAuth();
    const queryClient = useQueryClient();
    
    try { 
        const mutation = useMutation({
            mutationFn: async ({ commentText, parentId, files, onSuccessCallback }: { 
                commentText: string; 
                parentId?: string | null; 
                files?: File[]; 
                onSuccessCallback?: () => void; 
            }) => {
                // Removed logging
    
                if (!supabase) throw new Error("Supabase client not available");
                if (!user) throw new Error("User not authenticated");
                // Allow submitting comment if *either* text exists OR files exist
                if (!commentText?.trim() && (!files || files.length === 0)) { 
                     throw new Error("Comment cannot be empty without attachments.");
                }
                if (!variationId) throw new Error("Variation ID is required");
    
                // --- 1. Insert the comment text --- 
                const commentInsertData: { 
                    variation_id: string; 
                    user_id: string; 
                    content: string; 
                    parent_comment_id?: string | null;
                } = {
                    variation_id: variationId,
                    user_id: user.id, 
                    content: commentText.trim(), 
                };
                if (parentId) {
                    commentInsertData.parent_comment_id = parentId;
                }
    
                const { data: newComment, error: commentError } = await supabase
                    .from('comments')
                    .insert(commentInsertData)
                    .select()
                    .single();
    
                if (commentError || !newComment) {
                    // Removed logging
                    throw new Error(`Failed to add comment: ${commentError?.message}`);
                }
    
                // --- 2. Upload files and insert attachment records (if files exist) --- 
                const uploadedAttachments: Attachment[] = [];
                if (files && files.length > 0) {
                    // Removed logging
                    const bucketName = 'comment-attachments';
    
                    for (const file of files) {
                        // Removed logging
                        const uniqueFileName = `${Date.now()}-${file.name}`;
                        const filePath = `comments/${newComment.id}/${uniqueFileName}`;
                        // Removed logging
                        
                        const { error: uploadError } = await supabase.storage
                            .from(bucketName)
                            .upload(filePath, file, { upsert: false });
    
                        if (uploadError) {
                            // Removed logging
                            continue; 
                        }
                        // Removed logging
    
                        const attachmentInsertData = {
                            comment_id: newComment.id,
                            user_id: user.id,
                            file_path: filePath,
                            file_name: file.name, 
                            file_type: file.type,
                            file_size: file.size,
                        };
                        // Removed logging
                        
                        const { data: newAttachment, error: attachmentError } = await supabase
                            .from('attachments')
                            .insert(attachmentInsertData)
                            .select()
                            .single();
    
                        if (attachmentError || !newAttachment) {
                             // Removed logging
                             continue;
                        }
                        // Removed logging
                        uploadedAttachments.push(newAttachment);
                        // Removed logging

                        // --- ADDED: Trigger Image Processing API for this successfully uploaded attachment ---
                        if (newAttachment.file_path) { // Ensure file_path exists
                            console.log(`[AddCommentAttachment] Triggering image processing for: ${newAttachment.file_path}`);
                            try {
                                const processResponse = await fetch('/api/process-image', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({ originalPath: newAttachment.file_path }),
                                });
                                if (!processResponse.ok) {
                                    const errorBody = await processResponse.json().catch(() => ({ error: 'Image processing API request failed with status ' + processResponse.status }));
                                    console.error(`[AddCommentAttachment] Image processing API call failed for ${newAttachment.file_path}. Status: ${processResponse.status}`, errorBody);
                                    toast.warning(`Attachment ${newAttachment.file_name} uploaded, but processing failed: ${errorBody.error || 'Unknown error'}`);
                                } else {
                                    console.log(`[AddCommentAttachment] Image processing API call successful for ${newAttachment.file_path}`);
                                }
                            } catch (processError) {
                                console.error(`[AddCommentAttachment] Error calling image processing API for ${newAttachment.file_path}:`, processError);
                                toast.warning(`Attachment ${newAttachment.file_name} uploaded, but an error occurred while triggering processing: ${processError instanceof Error ? processError.message : 'Unknown error'}`);
                            }
                        }
                        // --- END: Trigger Image Processing ---
                    }
                     // Removed logging
                }
    
                return { ...newComment, attachments: uploadedAttachments, onSuccessCallback };
            },
            onSuccess: (data, variables) => {
                const commentSnippet = data.content ? `"${data.content.substring(0, 20)}..."` : '';
                const attachmentCount = data.attachments?.length || 0;
                let successMessage = 'Comment added successfully!';
                if (attachmentCount > 0 && data.content) {
                    successMessage = `Comment ${commentSnippet} with ${attachmentCount} attachment(s) added!`;
                } else if (attachmentCount > 0) {
                    successMessage = `${attachmentCount} attachment(s) added successfully!`;
                }
    
                toast.success(successMessage);
                queryClient.invalidateQueries({ queryKey: ['comments', variationId] }); 
                variables.onSuccessCallback?.(); 
            },
            onError: (error) => {
                toast.error(error.message);
            },
        }); 
        return mutation; 
    } catch (error) {
        throw error; 
    }
};

export const useUpdateComment = (variationId: string | null) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ 
            commentId, 
            newContent,
            onSuccessCallback 
        }: { 
            commentId: string; 
            newContent: string;
            onSuccessCallback?: () => void;
        }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!commentId) throw new Error("Comment ID is required");
            if (!newContent.trim()) throw new Error("Comment content cannot be empty");

            const { data, error } = await supabase
                .from('comments')
                .update({ 
                    content: newContent.trim(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', commentId)
                .select()
                .single();

            if (error) {
                throw new Error(`Failed to update comment: ${error.message}`);
            }

            return { data, onSuccessCallback };
        },
        onSuccess: ({ data, onSuccessCallback }) => {
            toast.success('Comment updated successfully!');
            if (variationId) {
                queryClient.invalidateQueries({ queryKey: ['comments', variationId] });
            }
            onSuccessCallback?.();
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

export const useDeleteComment = (variationId: string | null) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (commentId: string) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!commentId) throw new Error("Comment ID is required");

            const { error } = await supabase
                .from('comments')
                .delete()
                .eq('id', commentId);

            if (error) {
                throw new Error(`Failed to delete comment: ${error.message}`);
            }

            return commentId;
        },
        onSuccess: (commentId) => {
            toast.success('Comment deleted successfully!');
            if (variationId) {
                queryClient.invalidateQueries({ queryKey: ['comments', variationId] });
            }
        },
        onError: (error) => {
            toast.error(`Failed to delete comment: ${error.message}`);
        },
    }); 
}

// --- Update Variation Status Hook ---
export const useUpdateVariationStatus = (versionId: string, variationId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (newStatus: VariationFeedbackStatus) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Variation ID is required to update status");

            const { data, error } = await supabase
                .from('variations')
                .update({ 
                    status: newStatus,
                    updated_at: new Date().toISOString() 
                })
                .eq('id', variationId)
                .select('id, variation_letter, status') // Select minimal data needed
                .single();

            if (error) {
                console.error(`Error updating variation ${variationId} status to ${newStatus}:`, error);
                throw new Error(`Failed to update variation status: ${error.message}`);
            }
            return data;
        },
        onSuccess: (data, variables) => {
            toast.success(`Variation ${data.variation_letter} status updated to ${data.status}.`);
            // Invalidate the parent version query using the passed versionId
            queryClient.invalidateQueries({ queryKey: ['version', versionId, 'details'] });
        },
        onError: (error: Error, variables) => {
            toast.error(`Failed to update status to ${variables}: ${error.message}`);
        },
    });
}; 