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
const getBaseFileNameForDeletion = (filePath: string | null | undefined): string => {
    if (!filePath) return '';
    const parts = filePath.split('/');
    const fileNameWithAnyExt = parts.pop() || '';
    const fileNameWithoutAnyExt = fileNameWithAnyExt.split('.').slice(0, -1).join('.');
    // Handle potential suffixes added during upload (like timestamp)
    // This regex assumes a pattern like `-<digits>-` before the actual name
    // Adjust if your unique naming convention is different
    // Simpler approach: Just remove _WIDTH suffix if present
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
                    const baseFileName = getBaseFileNameForDeletion(originalFilePath);
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

            const oldFilePath = variation.file_path; // Store the old file path

            // --- ADDED: Attempt to delete OLD files before uploading new one ---
            if (oldFilePath) {
                console.log(`[ReplaceVar] Starting cleanup for old file: ${oldFilePath}`);
                const DESIGN_VARIATIONS_BUCKET = 'design-variations'; // Ensure defined
                const PROCESSED_IMAGES_BUCKET = 'processed-images'; // Ensure defined
                const oldProcessedPaths: string[] = [];

                const isOldGif = oldFilePath.toLowerCase().endsWith('.gif');
                const oldParts = oldFilePath.split('/');
                const oldFileNameWithExt = oldParts.pop() || '';
                const oldBasePath = oldParts.join('/');
                const oldFileNameWithoutExt = oldFileNameWithExt.includes('.')
                    ? oldFileNameWithExt.substring(0, oldFileNameWithExt.lastIndexOf('.'))
                    : oldFileNameWithExt;

                if (isOldGif) {
                    oldProcessedPaths.push(oldFilePath);
                } else {
                    [THUMBNAIL_WIDTH, MEDIUM_WIDTH, LARGE_WIDTH].forEach(width => {
                        oldProcessedPaths.push(`${oldBasePath}/${oldFileNameWithoutExt}_${width}.webp`);
                    });
                }

                try {
                    // Delete old original
                    console.log(`[ReplaceVar] Attempting to delete old original from ${DESIGN_VARIATIONS_BUCKET}: [${oldFilePath}]`);
                    const deleteOldOriginalResult = await supabase.storage
                        .from(DESIGN_VARIATIONS_BUCKET)
                        .remove([oldFilePath]);
                    console.log("[ReplaceVar] Raw result from deleting old original:", deleteOldOriginalResult);
                    if (deleteOldOriginalResult.error) {
                        console.warn(`[ReplaceVar] Failed to delete old original file ${oldFilePath} (continuing replacement):`, deleteOldOriginalResult.error);
                        // Don't toast error here, replacement is primary goal
                    } else {
                        console.log(`[ReplaceVar] Successfully reported deletion of old original file: ${oldFilePath}`);
                    }

                    // Delete old processed
                    if (oldProcessedPaths.length > 0) {
                        console.log(`[ReplaceVar] Attempting to delete old processed from ${PROCESSED_IMAGES_BUCKET}:`, oldProcessedPaths);
                        const deleteOldProcessedResult = await supabase.storage
                            .from(PROCESSED_IMAGES_BUCKET)
                            .remove(oldProcessedPaths);
                        console.log("[ReplaceVar] Raw result from deleting old processed:", deleteOldProcessedResult);
                        if (deleteOldProcessedResult.error) {
                            console.warn(`[ReplaceVar] Failed to delete old processed files for ${oldFilePath} (continuing replacement):`, deleteOldProcessedResult.error);
                        } else {
                            console.log(`[ReplaceVar] Successfully reported deletion of old processed files for: ${oldFilePath}`);
                        }
                    }
                } catch (cleanupError) {
                    console.warn(`[ReplaceVar] Exception during old file cleanup for ${oldFilePath} (continuing replacement):`, cleanupError);
                }
            }
            // --- END: Attempt to delete OLD files ---

            // Upload new file
            const newFilePath = `projects/${projectId}/designs/${designId}/versions/${variation.versions.id}/variations/${variationId}/${file.name}`;
            const { error: uploadError } = await supabase.storage
                .from('design-variations')
                .upload(newFilePath, file, { upsert: true });

            if (uploadError) {
                throw new Error(`Failed to upload new file: ${uploadError.message}`);
            }

            // Update variation with new file path
            const { data: updatedVariation, error: updateError } = await supabase
                .from('variations')
                .update({ 
                    file_path: newFilePath,
                    updated_at: new Date().toISOString()
                })
                .eq('id', variationId)
                .select()
                .single();

            if (updateError) {
                throw new Error(`Failed to update variation with new file path: ${updateError.message}`);
            }

            // --- ADDED: Trigger Image Processing API for the replaced file ---
            console.log(`[ReplaceVar] Triggering image processing for: ${newFilePath}`);
            try {
                const processResponse = await fetch('/api/process-image', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ originalPath: newFilePath }),
                });
                if (!processResponse.ok) {
                    const errorBody = await processResponse.json().catch(() => ({ error: 'Image processing API request failed with status ' + processResponse.status }));
                    console.error(`[ReplaceVar] Image processing API call failed for ${newFilePath}. Status: ${processResponse.status}`, errorBody);
                    toast.warning(`File replaced, but processing failed: ${errorBody.error || 'Unknown error'}`);
                } else {
                    console.log(`[ReplaceVar] Image processing API call successful for ${newFilePath}`);
                }
            } catch (processError) {
                console.error(`[ReplaceVar] Error calling image processing API for ${newFilePath}:`, processError);
                toast.warning(`File replaced, but an error occurred while triggering processing: ${processError instanceof Error ? processError.message : 'Unknown error'}`);
            }
            // --- END: Trigger Image Processing ---

            return updatedVariation;
        },
        onSuccess: () => {
            toast.success('Variation file replaced successfully!');
            // Invalidate the detailed view query
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
            // --- ADDED: Invalidate the project's design list query --- 
            if (projectId) { // Ensure projectId is available
                queryClient.invalidateQueries({ queryKey: ['designs', projectId] });
                console.log(`[ReplaceVar] Invalidated ['designs', '${projectId}'] query.`);
            }
            // --- END ADDED --- 
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
    const DESIGN_VARIATIONS_BUCKET = 'design-variations'; // Define buckets
    const PROCESSED_IMAGES_BUCKET = 'processed-images';

    return useMutation({
        mutationFn: async (designId: string) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!designId) throw new Error("Design ID is required");

            let variationFilePathsToDelete: string[] = [];

            // --- 1. Fetch variation file paths BEFORE deleting design ---
            try {
                console.log(`[DeleteDesign] Fetching variation file paths for design ID: ${designId}`);
                // Query needs to join variations -> versions -> designs (implicit via version's design_id)
                const { data: variations, error: fetchVariationsError } = await supabase
                    .from('versions') // Start from versions
                    .select(`
                        variations ( file_path )
                    `)
                    .eq('design_id', designId);

                if (fetchVariationsError) {
                    console.error("[DeleteDesign] Error fetching versions/variations:", fetchVariationsError);
                    toast.warning("Could not fetch variation details before deleting design.");
                } else if (variations && variations.length > 0) {
                    // Flatten the result and filter out null/empty file_paths
                    variationFilePathsToDelete = variations
                        .flatMap(v => v.variations)
                        .map(variation => variation?.file_path)
                        .filter((path): path is string => !!path);
                    console.log(`[DeleteDesign] Found variation paths to delete:`, variationFilePathsToDelete);
                }
            } catch (error) {
                console.error("[DeleteDesign] Exception fetching variation paths:", error);
                toast.warning("An exception occurred while fetching variation file paths.");
            }

            // --- 2. Delete design record (assuming DB cascades handle related records) ---
            console.log(`[DeleteDesign] Attempting to delete design record ID: ${designId}`);
            const { error: deleteDesignError } = await supabase
                .from('designs')
                .delete()
                .eq('id', designId);

            if (deleteDesignError) {
                console.error("[DeleteDesign] Error deleting design record:", deleteDesignError);
                throw new Error(`Failed to delete design: ${deleteDesignError.message}`);
            }
            console.log(`[DeleteDesign] Successfully deleted design record ID: ${designId}`);

            // --- 3. Attempt to delete associated storage files AFTER successful DB delete ---
            if (variationFilePathsToDelete.length > 0) {
                console.log(`[DeleteDesign] Starting storage cleanup for ${variationFilePathsToDelete.length} original variation files.`);

                for (const originalVariationPath of variationFilePathsToDelete) {
                    console.log(`[DeleteDesign] Processing cleanup for original variation path: ${originalVariationPath}`);
                    const processedPathsForThisVariation: string[] = [];

                    // Construct paths for processed files
                    const isGif = originalVariationPath.toLowerCase().endsWith('.gif');
                    const parts = originalVariationPath.split('/'); 
                    const fileNameWithExt = parts.pop() || ''; 
                    const basePath = parts.join('/'); // Should be like projects/PID/designs/DID/versions/VID/variations/VARID
                    const fileNameWithoutExt = fileNameWithExt.includes('.') 
                        ? fileNameWithExt.substring(0, fileNameWithExt.lastIndexOf('.')) 
                        : fileNameWithExt; 

                    if (isGif) {
                        // For GIFs, the processed path is the same as original
                        processedPathsForThisVariation.push(originalVariationPath); 
                    } else {
                        [THUMBNAIL_WIDTH, MEDIUM_WIDTH, LARGE_WIDTH].forEach(width => {
                            const processedPath = `${basePath}/${fileNameWithoutExt}_${width}.webp`;
                            processedPathsForThisVariation.push(processedPath);
                        });
                    }

                    // Perform deletions individually
                    try {
                        // Delete Original from design-variations
                        console.log(`[DeleteDesign] Attempting to delete original from ${DESIGN_VARIATIONS_BUCKET}: [${originalVariationPath}]`);
                        const deleteOriginalResult = await supabase.storage
                            .from(DESIGN_VARIATIONS_BUCKET)
                            .remove([originalVariationPath]);
                        console.log("[DeleteDesign] Raw result from deleting original variation:", deleteOriginalResult);
                        if (deleteOriginalResult.error) {
                            console.error(`[DeleteDesign] Failed to delete original variation file ${originalVariationPath}:`, deleteOriginalResult.error);
                            // Non-fatal warning
                        } else {
                            console.log(`[DeleteDesign] Successfully reported deletion of original variation file: ${originalVariationPath}`);
                        }

                        // Delete Processed from processed-images
                        if (processedPathsForThisVariation.length > 0) {
                            console.log(`[DeleteDesign] Attempting to delete processed from ${PROCESSED_IMAGES_BUCKET}:`, processedPathsForThisVariation);
                            const deleteProcessedResult = await supabase.storage
                                .from(PROCESSED_IMAGES_BUCKET)
                                .remove(processedPathsForThisVariation);

                            console.log("[DeleteDesign] Raw result from deleting processed variation:", deleteProcessedResult);
                            if (deleteProcessedResult.error) {
                                 console.error(`[DeleteDesign] Failed to delete processed variation files for ${originalVariationPath}:`, deleteProcessedResult.error);
                                 // Non-fatal warning
                            } else {
                                console.log(`[DeleteDesign] Successfully reported deletion of processed attachment files for: ${originalVariationPath}`);
                            }
                        }
                    } catch (storageError) {
                        console.error(`[DeleteDesign] Exception during storage file deletion for ${originalVariationPath}:`, storageError);
                        toast.warning("Design deleted, but encountered an error during storage cleanup."); // Inform user
                    }
                }
            } else {
                console.log(`[DeleteDesign] No variation file paths found for design ${designId}, skipping storage deletion.`);
            }

            return designId; // Return designId on success
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
    const COMMENT_ATTACHMENTS_BUCKET = 'comment-attachments';
    const DESIGN_VARIATIONS_BUCKET = 'design-variations';
    const PROCESSED_IMAGES_BUCKET = 'processed-images';

    return useMutation({
        mutationFn: async (projectId: string) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!projectId) throw new Error("Project ID is required");

            let allVariationPaths: string[] = [];
            let allCommentAttachmentPaths: string[] = [];

            // --- 1. Fetch ALL relevant file paths for the entire project BEFORE deleting --- 
            try {
                console.log(`[DeleteProject] Fetching all designs and related file paths for project ID: ${projectId}`);
                // We need designs -> versions -> variations (file_path) -> comments -> attachments (file_path)
                const { data: designs, error: fetchError } = await supabase
                    .from('designs')
                    .select(`
                        id,
                        versions (
                            id,
                            variations (
                                id,
                                file_path,
                                comments (
                                    id,
                                    attachments ( file_path )
                                )
                            )
                        )
                    `)
                    .eq('project_id', projectId);

                if (fetchError) {
                    console.error("[DeleteProject] Error fetching design/version/variation/comment/attachment data:", fetchError);
                    toast.warning("Could not fetch all file paths before deleting project. Some storage files might be orphaned.");
                    // Proceed with DB deletion, but skip storage cleanup
                } else if (designs && designs.length > 0) {
                    designs.forEach(design => {
                        design.versions.forEach(version => {
                            version.variations.forEach(variation => {
                                if (variation.file_path) {
                                    allVariationPaths.push(variation.file_path);
                                }
                                variation.comments.forEach((comment: any) => {
                                    comment.attachments.forEach((attachment: any) => {
                                        if (attachment.file_path) {
                                            allCommentAttachmentPaths.push(attachment.file_path);
                                        }
                                    });
                                });
                            });
                        });
                    });
                    console.log(`[DeleteProject] Found ${allVariationPaths.length} variation paths and ${allCommentAttachmentPaths.length} comment attachment paths to delete.`);
                } else {
                    console.log(`[DeleteProject] No designs found for project ${projectId}.`);
                }

            } catch (error) {
                console.error("[DeleteProject] Exception fetching file paths:", error);
                toast.warning("An exception occurred while fetching file paths. Some storage files might be orphaned.");
                // Proceed with DB deletion, but skip storage cleanup
            }

            // --- 2. Delete project record (assuming DB cascades handle related records) --- 
            console.log(`[DeleteProject] Attempting to delete project record ID: ${projectId}`);
            const { error: deleteProjectDbError } = await supabase
                .from('projects')
                .delete()
                .eq('id', projectId);

            if (deleteProjectDbError) {
                console.error("[DeleteProject] Error deleting project record:", deleteProjectDbError);
                throw new Error(`Failed to delete project: ${deleteProjectDbError.message}`);
            }
            console.log(`[DeleteProject] Successfully deleted project record ID: ${projectId}`);

            // --- 3. Process Deletion for Comment Attachments --- 
            if (allCommentAttachmentPaths.length > 0) {
                console.log(`[DeleteProject] Starting storage cleanup for ${allCommentAttachmentPaths.length} comment attachments.`);
                for (const originalPath of allCommentAttachmentPaths) {
                    const processedPaths: string[] = [];
                    const isGif = originalPath.toLowerCase().endsWith('.gif');
                    const parts = originalPath.split('/');
                    const fileNameWithExt = parts.pop() || '';
                    const basePath = parts.join('/');
                    const fileNameWithoutExt = fileNameWithExt.includes('.') ? fileNameWithExt.substring(0, fileNameWithExt.lastIndexOf('.')) : fileNameWithExt;
                    
                    if (isGif) {
                        processedPaths.push(originalPath);
                    } else {
                        [THUMBNAIL_WIDTH, MEDIUM_WIDTH, LARGE_WIDTH].forEach(width => {
                            processedPaths.push(`${basePath}/${fileNameWithoutExt}_${width}.webp`);
                        });
                    }

                    try {
                        console.log(`[DeleteProject] Deleting original comment attachment: [${originalPath}]`);
                        const { error: delOrigErr } = await supabase.storage.from(COMMENT_ATTACHMENTS_BUCKET).remove([originalPath]);
                        if (delOrigErr) console.warn(`[DeleteProject] Failed to delete original comment file ${originalPath}:`, delOrigErr);
                        else console.log(`[DeleteProject] Reported deletion of original comment file: ${originalPath}`);

                        if (processedPaths.length > 0) {
                             console.log(`[DeleteProject] Deleting processed comment attachment(s):`, processedPaths);
                            const { error: delProcErr } = await supabase.storage.from(PROCESSED_IMAGES_BUCKET).remove(processedPaths);
                            if (delProcErr) console.warn(`[DeleteProject] Failed to delete processed comment files for ${originalPath}:`, delProcErr);
                            else console.log(`[DeleteProject] Reported deletion of processed comment files for: ${originalPath}`);
                        }
                    } catch (e) {
                        console.warn(`[DeleteProject] Exception cleaning up comment attachment ${originalPath}:`, e);
                    }
                }
            } else {
                console.log(`[DeleteProject] No comment attachments found for project ${projectId}.`);
            }
            
            // --- 4. Process Deletion for Design Variations --- 
            if (allVariationPaths.length > 0) {
                console.log(`[DeleteProject] Starting storage cleanup for ${allVariationPaths.length} design variations.`);
                 for (const originalPath of allVariationPaths) {
                    const processedPaths: string[] = [];
                    const isGif = originalPath.toLowerCase().endsWith('.gif');
                    const parts = originalPath.split('/');
                    const fileNameWithExt = parts.pop() || '';
                    const basePath = parts.join('/');
                    const fileNameWithoutExt = fileNameWithExt.includes('.') ? fileNameWithExt.substring(0, fileNameWithExt.lastIndexOf('.')) : fileNameWithExt;
                    
                    if (isGif) {
                        processedPaths.push(originalPath);
                    } else {
                        [THUMBNAIL_WIDTH, MEDIUM_WIDTH, LARGE_WIDTH].forEach(width => {
                            processedPaths.push(`${basePath}/${fileNameWithoutExt}_${width}.webp`);
                        });
                    }

                    try {
                        console.log(`[DeleteProject] Deleting original design variation: [${originalPath}]`);
                        const { error: delOrigErr } = await supabase.storage.from(DESIGN_VARIATIONS_BUCKET).remove([originalPath]);
                        if (delOrigErr) console.warn(`[DeleteProject] Failed to delete original variation file ${originalPath}:`, delOrigErr);
                        else console.log(`[DeleteProject] Reported deletion of original variation file: ${originalPath}`);

                        if (processedPaths.length > 0) {
                             console.log(`[DeleteProject] Deleting processed design variation(s):`, processedPaths);
                            const { error: delProcErr } = await supabase.storage.from(PROCESSED_IMAGES_BUCKET).remove(processedPaths);
                            if (delProcErr) console.warn(`[DeleteProject] Failed to delete processed variation files for ${originalPath}:`, delProcErr);
                            else console.log(`[DeleteProject] Reported deletion of processed variation files for: ${originalPath}`);
                        }
                    } catch (e) {
                        console.warn(`[DeleteProject] Exception cleaning up design variation ${originalPath}:`, e);
                    }
                }
            } else {
                 console.log(`[DeleteProject] No design variations found for project ${projectId}.`);
            }

            console.log(`[DeleteProject] Storage cleanup finished for project ${projectId}.`);
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

// --- Project Mutations ---
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
    const COMMENT_ATTACHMENTS_BUCKET = 'comment-attachments';
    const PROCESSED_IMAGES_BUCKET = 'processed-images';

    return useMutation({
        mutationFn: async (commentId: string) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!commentId) throw new Error("Comment ID is required");

            let attachmentFilePaths: string[] = [];

            // --- 1. Fetch associated attachment file paths BEFORE deleting comment ---
            try {
                console.log(`[DeleteComment] Fetching attachments for comment ID: ${commentId}`);
                const { data: attachments, error: fetchAttachError } = await supabase
                    .from('attachments')
                    .select('file_path')
                    .eq('comment_id', commentId);

                if (fetchAttachError) {
                    console.error("[DeleteComment] Error fetching attachments:", fetchAttachError);
                    // Decide if we should proceed? Let's proceed but log the error.
                    toast.warning("Could not fetch attachment details before deleting comment.");
                } else if (attachments && attachments.length > 0) {
                    attachmentFilePaths = attachments.map(a => a.file_path).filter(Boolean); // Get non-null paths
                    console.log(`[DeleteComment] Found attachment paths to delete:`, attachmentFilePaths);
                }
            } catch (error) {
                console.error("[DeleteComment] Exception fetching attachments:", error);
                toast.warning("An exception occurred while fetching attachment details.");
            }

            // --- 2. Delete the comment record (and its attachments via DB cascade) ---
            console.log(`[DeleteComment] Attempting to delete comment record ID: ${commentId}`);
            const { error: deleteCommentError } = await supabase
                .from('comments')
                .delete()
                .eq('id', commentId);

            if (deleteCommentError) {
                console.error("[DeleteComment] Error deleting comment record:", deleteCommentError);
                throw new Error(`Failed to delete comment: ${deleteCommentError.message}`);
            }
            console.log(`[DeleteComment] Successfully deleted comment record ID: ${commentId}`);

            // --- 3. Attempt to delete associated storage files AFTER successful DB delete ---
            if (attachmentFilePaths.length > 0) {
                console.log(`[DeleteComment] Starting storage cleanup for ${attachmentFilePaths.length} original files.`);
                // REMOVED batch arrays: const originalPathsToDelete: string[] = [];
                // REMOVED batch arrays: const processedPathsToDelete: string[] = [];

                // --- Iterate and delete one by one for debugging --- 
                for (const originalFilePath of attachmentFilePaths) {
                    console.log(`[DeleteComment] Processing cleanup for original path: ${originalFilePath}`);
                    const processedPathsForThisFile: string[] = [];

                    // Construct paths for processed files
                    const isGif = originalFilePath.toLowerCase().endsWith('.gif');
                    
                    // --- REVERTED: Use full basePath which includes 'comments/' ---
                    const parts = originalFilePath.split('/'); // e.g., ["comments", "COMMENT_ID", "TIMESTAMP-FILENAME.png"]
                    const fileNameWithExt = parts.pop() || ''; 
                    const basePath = parts.join('/'); // e.g., "comments/COMMENT_ID"
                    const fileNameWithoutExt = fileNameWithExt.includes('.') 
                        ? fileNameWithExt.substring(0, fileNameWithExt.lastIndexOf('.')) 
                        : fileNameWithExt; 
                    // --- End Reverted --- 

                    if (isGif) {
                        // For GIFs, the processed path is the same as original ('comments/COMMENT_ID/FILENAME.gif')
                        processedPathsForThisFile.push(originalFilePath); 
                    } else {
                        [THUMBNAIL_WIDTH, MEDIUM_WIDTH, LARGE_WIDTH].forEach(width => {
                            // Use the full basePath here
                            const processedPath = `${basePath}/${fileNameWithoutExt}_${width}.webp`;
                            processedPathsForThisFile.push(processedPath);
                        });
                    }
                    // --- END Individual Deletion ---

                    // Perform deletions individually
                    try {
                        // Delete Original
                        console.log(`[DeleteComment] Attempting to delete original from ${COMMENT_ATTACHMENTS_BUCKET}: [${originalFilePath}]`);
                        const deleteOriginalResult = await supabase.storage
                            .from(COMMENT_ATTACHMENTS_BUCKET)
                            .remove([originalFilePath]); // Pass path in an array
                        
                        console.log("[DeleteComment] Raw result from deleting original:", deleteOriginalResult);
                        
                        if (deleteOriginalResult.error) {
                            console.error(`[DeleteComment] Failed to delete original attachment file ${originalFilePath}:`, deleteOriginalResult.error);
                            toast.warning(`Failed to clean up original attachment file: ${originalFilePath}`);
                        } else {
                            console.log(`[DeleteComment] Successfully reported deletion of original attachment file: ${originalFilePath}`);
                        }

                        // Delete Processed
                        if (processedPathsForThisFile.length > 0) {
                            // --- REMOVED DETAILED DEBUG LOG ---
                            // console.log(`[DeleteComment DEBUG] Paths being sent to .remove() for PROCESSED_IMAGES_BUCKET: ${JSON.stringify(processedPathsForThisFile, null, 2)}`);
                            console.log(`[DeleteComment] Attempting to delete processed from ${PROCESSED_IMAGES_BUCKET}:`, processedPathsForThisFile);
                            const deleteProcessedResult = await supabase.storage
                                .from(PROCESSED_IMAGES_BUCKET)
                                .remove(processedPathsForThisFile);

                            console.log("[DeleteComment] Raw result from deleting processed:", deleteProcessedResult);

                            if (deleteProcessedResult.error) {
                                 console.error(`[DeleteComment] Failed to delete processed attachment files for ${originalFilePath}:`, deleteProcessedResult.error);
                                toast.warning(`Failed to clean up processed attachment files for: ${fileNameWithExt}`);
                            } else {
                                console.log(`[DeleteComment] Successfully reported deletion of processed attachment files for: ${originalFilePath}`);
                            }
                        }
                    } catch (storageError) {
                        console.error(`[DeleteComment] Exception during storage file deletion for ${originalFilePath}:`, storageError);
                        toast.warning("Comment deleted, but encountered an error during storage cleanup.");
                    }
                    // --- END Individual Deletion --- 
                }
                
                /* // REMOVED BATCH DELETION LOGIC
                // Perform deletions
                try {
                    if (originalPathsToDelete.length > 0) {
                        console.log(`[DeleteComment] Attempting to delete original attachments from ${COMMENT_ATTACHMENTS_BUCKET}:`, originalPathsToDelete);
                        const { error: deleteOriginalError } = await supabase.storage
                            .from(COMMENT_ATTACHMENTS_BUCKET)
                            .remove(originalPathsToDelete);
                        if (deleteOriginalError) {
                            console.error(`[DeleteComment] Failed to delete some original attachment files:`, deleteOriginalError);
                            toast.warning("Comment deleted, but failed to clean up some original attachment files.");
                        } else {
                            console.log(`[DeleteComment] Successfully deleted original attachment files.`);
                        }
                    }

                    if (processedPathsToDelete.length > 0) {
                        console.log(`[DeleteComment] Attempting to delete processed attachments from ${PROCESSED_IMAGES_BUCKET}:`, processedPathsToDelete);
                        const { error: deleteProcessedError } = await supabase.storage
                            .from(PROCESSED_IMAGES_BUCKET)
                            .remove(processedPathsToDelete);
                        if (deleteProcessedError) {
                             console.error(`[DeleteComment] Failed to delete some processed attachment files:`, deleteProcessedError);
                            toast.warning("Comment deleted, but failed to clean up some processed attachment files.");
                        } else {
                            console.log(`[DeleteComment] Successfully deleted processed attachment files.`);
                        }
                    }
                } catch (storageError) {
                    console.error(`[DeleteComment] Exception during storage file deletion:`, storageError);
                    toast.warning("Comment deleted, but encountered an error during storage cleanup.");
                }
                */

            } else {
                console.log(`[DeleteComment] No attachment files found for comment ${commentId}, skipping storage deletion.`);
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