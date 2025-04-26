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

export const useAddVersionWithVariations = (
    designId: string,
    projectId: string,
    setCurrentVersionId: (id: string) => void,
    setCurrentVariationId: (id: string) => void
) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

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

            // Create variations and upload files
            const variations: Variation[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const variationLetter = String.fromCharCode(65 + i); // A, B, C...

                // Create variation record
                const { data: newVariation, error: variationError } = await supabase
                    .from('variations')
                    .insert({
                        version_id: newVersion.id,
                        variation_letter: variationLetter,
                        status: VariationFeedbackStatus.PendingFeedback
                    })
                    .select()
                    .single();

                if (variationError || !newVariation) {
                    throw new Error(`Failed to create variation ${variationLetter}: ${variationError?.message}`);
                }

                // Upload file
                const filePath = `projects/${projectId}/designs/${designId}/versions/${newVersion.id}/variations/${newVariation.id}/${file.name}`;
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

                variations.push(updatedVariation);
            }

            return { version: newVersion, variations };
        },
        onSuccess: (data) => {
            toast.success(`Version ${data.version.version_number} created with ${data.variations.length} variation(s)!`);
            // Update state
            setCurrentVersionId(data.version.id);
            if (data.variations.length > 0) {
                setCurrentVariationId(data.variations[0].id);
            }
            // Invalidate queries
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] });
            queryClient.invalidateQueries({ queryKey: ['designs', projectId] });
        },
        onError: (error) => {
            toast.error(error.message);
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