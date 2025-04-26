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
    Attachment
} from '@/types/models';

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

// Add UploadingFileInfo type if not already present
interface UploadingFileInfo {
    id: string;
    file: File;
    previewUrl: string;
    status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';
    progress: number;
    error?: string;
    xhr?: XMLHttpRequest;
    uploadStarted: boolean;
}

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

    return useMutation({
        mutationFn: async ({ files }: { files: File[] }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!designId) throw new Error("Design ID is required");

            // Get the latest version number
            const { data: versions, error: versionsError } = await supabase
                .from('versions')
                .select('version_number')
                .eq('design_id', designId)
                .order('version_number', { ascending: false })
                .limit(1);

            if (versionsError) throw new Error(`Failed to get latest version number: ${versionsError.message}`);

            const nextVersionNumber = versions && versions.length > 0 ? versions[0].version_number + 1 : 1;

            // Create new version
            const { data: newVersion, error: versionError } = await supabase
                .from('versions')
                .insert({
                    design_id: designId,
                    version_number: nextVersionNumber,
                    status: 'Work in Progress',
                    stage: DesignStage.Sketch // Default to Sketch stage
                })
                .select()
                .single();

            if (versionError || !newVersion) {
                throw new Error(`Failed to create version: ${versionError?.message}`);
            }

            // --- Implement Concurrency Control ---
            const CONCURRENCY_LIMIT = 3;
            let activePromises: Promise<Variation>[] = [];
            const results: PromiseSettledResult<Variation>[] = [];
            let fileIndex = 0;

            const processFile = async (file: File, index: number): Promise<Variation> => {
                const variationLetter = String.fromCharCode(65 + index);
                let newVariation: Variation | null = null;
                const fileId = `${newVersion.id}-${variationLetter}-${Date.now()}`;
                let filePath = '';

                try {
                    // Create variation record
                    const { data: createdVar, error: variationError } = await supabase
                        .from('variations')
                        .insert({ version_id: newVersion.id, variation_letter: variationLetter, status: VariationFeedbackStatus.PendingFeedback })
                        .select().single();
                    if (variationError || !createdVar) throw new Error(`Failed to create variation ${variationLetter}: ${variationError?.message}`);
                    newVariation = createdVar;

                    // Add to queue (initial state)
                    setUploadQueue(prev => [...prev, { id: fileId, file, previewUrl: URL.createObjectURL(file), status: 'pending', progress: 0, uploadStarted: false, xhr: undefined }]);
                    
                    // Mark as uploading in queue
                    setUploadQueue(prev => prev.map(f => f.id === fileId ? { ...f, status: 'uploading', uploadStarted: true } : f));
                    
                    if (!newVariation) throw new Error(`Variation record creation failed unexpectedly for ${variationLetter}`);

                    // Upload file via XHR
                    filePath = `projects/${projectId}/designs/${designId}/versions/${newVersion.id}/variations/${newVariation.id}/${file.name}`;
                    const { data: signedUrlData, error: signedUrlError } = await supabase.storage.from(BUCKET_NAME).createSignedUploadUrl(filePath);
                    if (signedUrlError) throw new Error(`Failed to get signed URL: ${signedUrlError.message}`);
                    if (!signedUrlData?.signedUrl) throw new Error("No signed URL returned.");
                    const signedUrl = signedUrlData.signedUrl;

                    await new Promise<void>((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        setUploadQueue(prev => prev.map(f => f.id === fileId ? { ...f, xhr: xhr } : f));
                        xhr.open('PUT', signedUrl, true);
                        xhr.setRequestHeader('Content-Type', file.type);
                        xhr.upload.onprogress = (event) => {
                            if (event.lengthComputable) {
                                const progress = Math.round((event.loaded / event.total) * 100);
                                setUploadQueue(prev => prev.map(f => f.id === fileId ? { ...f, progress: progress, status: 'uploading' } : f));
                            }
                        };
                        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed: ${xhr.statusText || 'XHR Error'}`));
                        xhr.onerror = () => reject(new Error('Upload failed: Network error'));
                        xhr.onabort = () => {
                            setUploadQueue(prev => prev.map(f => f.id === fileId ? { ...f, status: 'cancelled', progress: 0 } : f));
                            resolve(); // Resolve on abort
                        };
                        xhr.send(file);
                    });

                    if (!newVariation) throw new Error(`Variation record lost for ${variationLetter} before final update.`);

                    // Update variation with file path
                    const { data: updatedVariation, error: updateError } = await supabase.from('variations').update({ file_path: filePath }).eq('id', newVariation.id).select().single();
                    if (updateError) throw new Error(`Failed to update variation ${variationLetter} with file path: ${updateError.message}`);
                    
                    return updatedVariation;
                } catch (error: any) {
                    console.error(`Error processing file ${file.name} for variation ${variationLetter}:`, error);
                    setUploadQueue(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error', error: error.message || 'Failed', progress: 0 } : f));
                    // Re-throw the error to be caught by the concurrency manager
                    throw error; 
                }
            };

            const fileIterator = files.entries(); // Use entries to get index
            let nextFile = fileIterator.next();

            while (fileIndex < files.length || activePromises.length > 0) {
                while (activePromises.length < CONCURRENCY_LIMIT && !nextFile.done) {
                    const [currentIndex, currentFile] = nextFile.value;
                    const promise = processFile(currentFile, currentIndex)
                        .then(result => {
                            results.push({ status: 'fulfilled', value: result });
                            return result; // Return value for removal logic
                        })
                        .catch(error => {
                            results.push({ status: 'rejected', reason: error });
                            return error; // Return error for removal logic
                        });
                    
                    // Add the promise wrapper (that always resolves) to activePromises
                    const wrappedPromise = promise.finally(() => {
                         // Remove the wrapped promise itself from activePromises when settled
                        activePromises = activePromises.filter(p => p !== wrappedPromise);
                    });
                    activePromises.push(wrappedPromise);
                    
                    fileIndex++;
                    nextFile = fileIterator.next();
                }

                // Wait for at least one promise to settle if the limit is reached or no more files to queue
                if (activePromises.length > 0) {
                    await Promise.race(activePromises);
                } else {
                    // Break if no more files and no active promises
                    break;
                }
            }
            // --- End Concurrency Control ---

            // Process results (similar to Promise.allSettled)
            const successfulVariations = results
                .filter((result): result is PromiseFulfilledResult<Variation> => result.status === 'fulfilled')
                .map(result => result.value);

            const failedCount = results.length - successfulVariations.length;
            if (failedCount > 0) {
                console.warn(`[AddVersion] ${failedCount} variation(s) failed to process.`);
            }

            // Return the new version and successfully created variations
            return { version: newVersion, variations: successfulVariations };
        },
        onSuccess: (data) => {
            // Handle success (update UI state, invalidate queries)
            // Only remove successful uploads from queue?
            setUploadQueue(prev => prev.filter(item => 
                !data.variations.some(v => item.id.startsWith(`${data.version.id}-${v.variation_letter}-`))
            ));
            toast.success(`Version ${data.version.version_number} created with ${data.variations.length} variation(s)!`);
            setCurrentVersionId(data.version.id);
            if (data.variations.length > 0) {
                setCurrentVariationId(data.variations[0].id);
            }
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
            queryClient.invalidateQueries({ queryKey: ['designs', projectId] });
        },
        onError: (error: Error) => {
            // Error handled within loop for individual files, this catches version creation errors etc.
            toast.error(`Failed to add version: ${error.message}`);
            // Ensure queue items related to this attempt (if any started) are marked as error
            // This might be complex if version creation failed before loop started.
            // Simple approach: mark all 'pending'/'uploading' related to this *potential* version as error?
            // Need a way to link queue items to the attempt if version ID isn't known yet.
            // For now, rely on the catch block inside the loop to mark individual file errors.
        },
    });
};

export const useAddVariationsToVersion = (versionId: string, designId: string, projectId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ files }: { files: File[] }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!versionId) throw new Error("Version ID is required");

            // Get existing variations to determine next letters
            const { data: existingVariations, error: existingError } = await supabase
                .from('variations')
                .select('variation_letter')
                .eq('version_id', versionId)
                .order('variation_letter', { ascending: false });

            if (existingError) throw new Error(`Failed to get existing variations: ${existingError.message}`);

            let nextLetterCode = existingVariations && existingVariations.length > 0
                ? existingVariations[0].variation_letter.charCodeAt(0) + 1
                : 65; // ASCII for 'A'

            const newVariations: Variation[] = [];
            for (const file of files) {
                const variationLetter = String.fromCharCode(nextLetterCode++);

                // Create variation
                const { data: newVariation, error: variationError } = await supabase
                    .from('variations')
                    .insert({
                        version_id: versionId,
                        variation_letter: variationLetter,
                        status: VariationFeedbackStatus.PendingFeedback
                    })
                    .select()
                    .single();

                if (variationError || !newVariation) {
                    throw new Error(`Failed to create variation ${variationLetter}: ${variationError?.message}`);
                }

                // Upload file
                const filePath = `projects/${projectId}/designs/${designId}/versions/${versionId}/variations/${newVariation.id}/${file.name}`;
                const { error: uploadError } = await supabase.storage
                    .from('design-variations')
                    .upload(filePath, file);

                if (uploadError) {
                    throw new Error(`Failed to upload file for variation ${variationLetter}: ${uploadError.message}`);
                }

                // Update variation with file path
                const { data: updatedVariation, error: updateError } = await supabase
                    .from('variations')
                    .update({ file_path: filePath })
                    .eq('id', newVariation.id)
                    .select()
                    .single();

                if (updateError) {
                    throw new Error(`Failed to update variation ${variationLetter} with file path: ${updateError.message}`);
                }

                newVariations.push(updatedVariation);
            }

            return newVariations;
        },
        onSuccess: (variations) => {
            toast.success(`Added ${variations.length} new variation(s)!`);
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- Variation Mutations ---
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

export const useDeleteVariation = (variationId: string, designId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Variation ID is required");

            // Delete variation record (storage cleanup handled by trigger)
            const { error } = await supabase
                .from('variations')
                .delete()
                .eq('id', variationId);

            if (error) {
                throw new Error(`Failed to delete variation: ${error.message}`);
            }

            return variationId;
        },
        onSuccess: () => {
            toast.success('Variation deleted successfully!');
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