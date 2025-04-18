'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, Pencil, Check, X, ChevronLeft, ChevronRight, Replace, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import Breadcrumbs, { BreadcrumbItem } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
  DialogOverlay,
  DialogPortal,
} from '@/components/ui/dialog';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import Dropzone from '@/components/ui/dropzone';
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { DesignCard } from "@/components/cards/DesignCard";
import { 
    Design, 
    Project, 
    DesignDetailsData, 
    Version, 
    Variation, 
    DesignStage, 
    designOverallStatuses, 
    DesignOverallStatus, 
    DesignGridItem,
    VersionRoundStatus,
    VariationFeedbackStatus
} from '@/types/models';
import { ModalImageViewer } from '@/components/modal/ModalImageViewer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Comment } from '@/types/models';
import { CommentCard } from '@/components/cards/CommentCard';

// For Upload Queue
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

// Type for inserting a new design (form data)
type NewDesignForm = {
    name: string;
};

// --- Zod Schema for New Design Form ---
const designSchema = z.object({
  name: z.string().min(1, 'Design name is required'),
});

// Fetch function for a single project
const fetchProject = async (supabase: any, projectId: string): Promise<Project | null> => {
    if (!projectId) return null;

    const { data, error } = await supabase
        .from('projects')
        .select(`
            id,
            name,
            description,
            status,
            created_at,
            updated_at,
            client_id,
            clients ( id, name ) 
        `)
        .eq('id', projectId)
        .single(); // Fetch a single record

    if (error) {
        console.error('Error fetching project:', error);
        // Handle not found error specifically?
        if (error.code === 'PGRST116') { // PostgREST error for no rows found
             return null; // Or throw custom NotFoundError
        }
        throw new Error(error.message);
    }
    return data as Project | null;
};

// NEW: Fetch all projects for the sidebar
const fetchAllProjects = async (supabase: any): Promise<Pick<Project, 'id' | 'name' | 'status'>[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('projects')
        .select('id, name, status') // Select only needed fields
        .order('name', { ascending: true }); // Order alphabetically

    if (error) {
        console.error('Error fetching all projects:', error);
        throw new Error(error.message);
    }
    return data || [];
};

// Updated fetchDesigns to use RPC and return the specific grid item type
const fetchDesigns = async (supabase: any, projectId: string): Promise<DesignGridItem[]> => {
    if (!projectId || !supabase) return [];

    // Call the RPC function using the standard named parameter
    const { data, error } = await supabase.rpc('get_designs_with_latest_thumbnail', { 
        p_project_id: projectId // Correct named parameter
    });

    // --- DEBUG LOGGING --- 
    console.log('[fetchDesigns] Raw data from RPC:', data); 
    // --- END DEBUG LOGGING ---

    if (error) {
        console.error('RAW Supabase fetchDesigns RPC ERROR object:', JSON.stringify(error, null, 2)); 
        console.error('Error fetching designs via RPC:', error); 
        throw new Error(`Failed to fetch designs: ${error?.message || JSON.stringify(error)}`);
    }
    // The RPC function returns the data directly in the shape of our Design type (including the new field)
    return (data as DesignGridItem[]) || []; 
};

// NEW: Fetch detailed data for a single design for the modal
const fetchDesignDetails = async (supabase: any, designId: string): Promise<DesignDetailsData | null> => {
    if (!designId || !supabase) return null;

    const { data, error } = await supabase
        .from('designs')
        .select(`
            *,
            versions (
                *,
                variations (*)
            )
        `)
        .eq('id', designId)
        .order('version_number', { referencedTable: 'versions', ascending: true }) // Order versions ASC (V1, V2...)
        .order('variation_letter', { referencedTable: 'versions.variations', ascending: true }) // Order variations asc
        .single();

    if (error) {
        console.error('Error fetching design details:', error);
        throw new Error(`Failed to fetch design details: ${error.message}`);
    }

    // Ensure versions and variations are always arrays
    if (data && data.versions) {
        data.versions = data.versions.map((version: any) => ({
            ...version,
            variations: version.variations || []
        }));
    } else if (data) {
        data.versions = [];
    }

    return data as DesignDetailsData | null;
};

// --- NEW: Fetch Comments for a Specific Variation ---
const fetchCommentsForVariation = async (supabase: any, variationId: string | null): Promise<Comment[]> => {
    if (!supabase || !variationId) return []; // Return empty if no variation ID

    const { data, error } = await supabase
        .from('comments')
        .select(`
            *,
            profiles:user_id ( display_name ) 
        `)
        .eq('variation_id', variationId)
        .order('created_at', { ascending: true }); // Show oldest comments first

    if (error) {
        console.error("Error fetching comments:", error.message); // Log the message specifically
        throw new Error(`Failed to fetch comments: ${error.message}`);
    }
    // Ensure profiles is always an object or null
    return data?.map((comment: any) => ({ // Explicitly type comment as any for mapping
        ...comment, 
        profiles: comment.profiles || null 
    })) || [];
};

// --- Add Design Hook ---
const useAddDesign = (projectId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (newDesignData: NewDesignForm) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!projectId) throw new Error("Project ID is required");

            const insertData = {
                project_id: projectId,
                name: newDesignData.name,
                // stage defaults in DB, status defaults to Active
                // Ensure these match your DB constraints/defaults
            };

            const { data, error } = await supabase
                .from('designs')
                .insert(insertData)
                .select()
                .single();

            if (error) {
                console.error('Error adding design:', error);
                throw new Error(`Failed to add design: ${error.message}`);
            }
            return data;
        },
        onSuccess: (data) => {
            toast.success(`Design "${data.name}" added successfully!`);
            queryClient.invalidateQueries({ queryKey: ['designs', projectId] }); 
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- NEW: Hook to Create Design/Version/Variation from Upload --- 
const useCreateDesignFromUpload = (
    projectId: string,
    setUploadQueue: React.Dispatch<React.SetStateAction<UploadingFileInfo[]>>
) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    // Define types for nested inserts if not already defined
    // These might need adjustment based on your actual DB schema defaults/constraints
    type NewVersionData = { design_id: string; version_number: number; status: string; /* add stage if needed */ };
    type NewVariationData = { version_id: string; variation_letter: string; status: string; };

    return useMutation({
        // Expect an object with file and its queue ID
        mutationFn: async ({ file, fileId }: { file: File, fileId: string }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!projectId) throw new Error("Project ID is required");

            // Rename variables to avoid conflict
            let createdDesignId = '';
            let createdVersionId = '';
            let createdVariationId = '';
            let finalFilePath = '';

            try {
                // --- 1. Create Design --- 
                // Use filename without extension as initial design name
                const designName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                const { data: newDesign, error: designError } = await supabase
                    .from('designs')
                    .insert({ project_id: projectId, name: designName, status: 'Active' })
                    .select()
                    .single();
                
                if (designError) throw new Error(`Failed to create design: ${designError.message}`);
                if (!newDesign) throw new Error('Failed to create design, no data returned.');
                createdDesignId = newDesign.id;
                console.log(`[CreateDesignUpload] Created Design: ${createdDesignId} (${designName})`);

                // --- 2. Create Version (V1) --- 
                const versionData: NewVersionData = { design_id: createdDesignId, version_number: 1, status: 'Work in Progress' };
                const { data: newVersion, error: versionError } = await supabase
                    .from('versions')
                    .insert(versionData)
                    .select()
                    .single();

                if (versionError) throw new Error(`Failed to create version 1 for design ${createdDesignId}: ${versionError.message}`);
                if (!newVersion) throw new Error('Failed to create version, no data returned.');
                createdVersionId = newVersion.id;
                console.log(`[CreateDesignUpload] Created Version: ${createdVersionId} (V1)`);

                // --- 3. Create Variation (A) --- 
                const variationData: NewVariationData = { version_id: createdVersionId, variation_letter: 'A', status: 'Pending Feedback' }; 
                const { data: newVariation, error: variationError } = await supabase
                    .from('variations')
                    .insert(variationData)
                    .select()
                    .single();

                if (variationError) throw new Error(`Failed to create variation A for version ${createdVersionId}: ${variationError.message}`);
                if (!newVariation) throw new Error('Failed to create variation, no data returned.');
                createdVariationId = newVariation.id;
                console.log(`[CreateDesignUpload] Created Variation: ${createdVariationId} (A)`);

                // --- 4. Upload File --- 
                finalFilePath = `projects/${projectId}/designs/${createdDesignId}/versions/${createdVersionId}/variations/${createdVariationId}/${file.name}`;
                const bucketName = 'design-variations';
                
                console.log(`[CreateDesignUpload] Attempting upload to: ${finalFilePath}`);
                const { error: uploadError } = await supabase.storage
                    .from(bucketName)
                    .upload(finalFilePath, file, { upsert: true }); // Use direct upload here

                if (uploadError) {
                     console.error(`[CreateDesignUpload] Upload failed for ${file.name}:`, uploadError);
                     throw new Error(`Storage upload failed: ${uploadError.message}`);
                }
                console.log(`[CreateDesignUpload] Successfully uploaded ${file.name} to ${finalFilePath}`);

                // --- 5. Update Variation with File Path --- 
                const { error: updateError } = await supabase
                    .from('variations')
                    .update({ file_path: finalFilePath })
                    .eq('id', createdVariationId);

                if (updateError) {
                    console.error(`[CreateDesignUpload] Failed to update variation ${createdVariationId} with file path ${finalFilePath}:`, updateError);
                    toast.warning(`File ${file.name} uploaded, but failed to link to variation record.`);
                }
                 console.log(`[CreateDesignUpload] Successfully linked ${finalFilePath} to variation ${createdVariationId}`);

                // Return the created design info AND the original fileId
                return { ...newDesign, filePath: finalFilePath, originalFileId: fileId }; 

            } catch (error: any) {
                 console.error(`[CreateDesignUpload] CRITICAL FAILURE for file ${file.name}:`, error);
                // Cleanup hints using created IDs
                if (createdDesignId) console.error(`[Cleanup Hint] May need to clean up design: ${createdDesignId}`);
                if (createdVersionId) console.error(`[Cleanup Hint] May need to clean up version: ${createdVersionId}`);
                if (createdVariationId) console.error(`[Cleanup Hint] May need to clean up variation: ${createdVariationId}`);
                // Add the fileId to the re-thrown error context? Maybe not necessary.
                 throw error;
            }
        },
        onSuccess: (data, variables) => {
            // variables = { file: File, fileId: string }
            // data = { ...newDesign, filePath: string, originalFileId: string }
            toast.success(`Design "${data.name}" created and file "${variables.file.name}" uploaded successfully!`);
            queryClient.invalidateQueries({ queryKey: ['designs', projectId] }); 
            // Remove successfully uploaded file from queue using the originalFileId from data
            setUploadQueue(prevQueue => 
                prevQueue.filter(f => f.id !== data.originalFileId)
            );
        },
        onError: (error: Error, variables) => {
             // variables = { file: File, fileId: string }
             toast.error(`Failed to create design from file "${variables.file.name}": ${error.message}`);
             // Mark file as error in queue using the fileId from variables
             setUploadQueue(prevQueue => 
                prevQueue.map(f => 
                    f.id === variables.fileId 
                        ? { ...f, status: 'error', error: error.message, uploadStarted: false } 
                        : f
                )
            ); 
        },
    });
};

// --- NEW: Add Comment Hook ---
const useAddComment = (designId: string, variationId: string) => {
    const { supabase, user } = useAuth(); // Get user from auth
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (commentText: string) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!user) throw new Error("User not authenticated"); // Check for user
            if (!designId) throw new Error("Design ID is required");
            if (!variationId) throw new Error("Variation ID is required");
            if (!commentText?.trim()) throw new Error("Comment text cannot be empty");

            const insertData = {
                variation_id: variationId,
                user_id: user.id, // Add user_id
                content: commentText.trim(), // Changed 'text' to 'content'
                // Removed design_id as it doesn't exist in the table
            };

            const { data, error } = await supabase
                .from('comments')
                .insert(insertData)
                .select()
                .single();

            if (error) {
                // Log the specific Supabase error message
                console.error('Supabase Error inserting comment:', error.message); 
                throw new Error(`Failed to add comment: ${error.message}`);
            }
            return data;
        },
        onSuccess: (data) => {
            toast.success(`Comment added successfully!`);
            // Invalidate the specific comments query for this variation
            queryClient.invalidateQueries({ queryKey: ['comments', variationId] }); 
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- NEW: Hook to Update VERSION Details (Stage/Status) ---
const useUpdateVersionDetails = (versionId: string, designId: string, projectId: string | null) => { // Added projectId
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ stage, status }: { stage: DesignStage, status: VersionRoundStatus }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!versionId) throw new Error("Version ID is required");

            const updateData = {
                stage: stage,
                status: status,
                updated_at: new Date().toISOString(),
            };

            const { data, error } = await supabase
                .from('versions') // <-- Update VERSIONS table
                .update(updateData)
                .eq('id', versionId)
                .select()
                .single();

            if (error) {
                // Enhanced logging
                console.error('RAW Supabase updateVersionDetails ERROR object:', JSON.stringify(error, null, 2)); 
                console.error('Error updating version details:', error); 
                // Throw error with stringified object
                throw new Error(`Failed to update version details: ${error?.message || JSON.stringify(error)}`);
            }
            return data;
        },
        onSuccess: (data) => {
            console.log('[UpdateVersionSuccess] Data:', data); // <-- Keep logging for now
            toast.success(`Version ${data.version_number} updated successfully!`);
            // Invalidate design details to refetch version data
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] }); 
            // Use the passed projectId for designs invalidation
            if (projectId) {
                queryClient.invalidateQueries({ queryKey: ['designs', projectId] }); 
            }
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- NEW: Hook to Update VARIATION Details (Status) ---
const useUpdateVariationDetails = (variationId: string, designId: string, projectId: string | null) => { // Added projectId
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ status }: { status: VariationFeedbackStatus }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Variation ID is required");

            const updateData = {
                status: status,
                updated_at: new Date().toISOString(),
            };

            const { data, error } = await supabase
                .from('variations') // <-- Update VARIATIONS table
                .update(updateData)
                .eq('id', variationId)
                .select()
                .single();

            if (error) {
                console.error('Error updating variation details:', error);
                throw new Error(`Failed to update variation status: ${error.message}`);
            }
            return data;
        },
        onSuccess: (data) => {
            toast.success(`Variation ${data.variation_letter} status updated to ${data.status}!`);
            // Invalidate design details to refetch variation data within the modal
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] }); 
            // ALSO invalidate the designs grid query for the current project
            if (projectId) {
                queryClient.invalidateQueries({ queryKey: ['designs', projectId] }); 
            }
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- Update Project Details Hook ---
const useUpdateProjectDetails = (projectId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ name, description }: { name: string, description: string | null }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!projectId) throw new Error("Project ID is required");
            if (!name?.trim()) throw new Error("Project name cannot be empty");

            const updateData: { name: string, description?: string | null, updated_at: string } = {
                name: name.trim(),
                updated_at: new Date().toISOString()
            };
            if (description !== undefined) {
                updateData.description = description;
            }

            const { data, error } = await supabase
                .from('projects') // Target projects table
                .update(updateData)
                .eq('id', projectId) // Use projectId
                .select()
                .single();

            if (error) {
                console.error('Full Supabase Update Project Details Error:', error);
                throw new Error(`Failed to update project details: ${error?.message || JSON.stringify(error)}`);
            }
            return data;
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- NEW: Hook to Add Version with Variations --- 
const useAddVersionWithVariations = (
    designId: string,
    projectId: string,
    setCurrentVersionId: React.Dispatch<React.SetStateAction<string | null>>,
    setCurrentVariationId: React.Dispatch<React.SetStateAction<string | null>>
) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    // Helper type for the mutation function argument
    type AddVersionPayload = {
        files: File[];
    };

    return useMutation({
        mutationFn: async ({ files }: AddVersionPayload) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!designId) throw new Error("Design ID is required");
            if (!projectId) throw new Error("Project ID is required");
            if (!files || files.length === 0) throw new Error("No files provided");

            console.log(`[AddVersion] Starting process for ${files.length} files on design ${designId}`);

            // --- 1. Determine New Version Number --- 
            const { data: existingVersions, error: fetchError } = await supabase
                .from('versions')
                .select('version_number')
                .eq('design_id', designId)
                .order('version_number', { ascending: false })
                .limit(1);

            if (fetchError) {
                console.error("[AddVersion] Error fetching existing versions:", fetchError);
                throw new Error(`Failed to determine next version number: ${fetchError.message}`);
            }

            const latestVersionNumber = existingVersions?.[0]?.version_number ?? 0;
            const newVersionNumber = latestVersionNumber + 1;
            console.log(`[AddVersion] Determined new version number: ${newVersionNumber}`);

            // --- 2. Create New Version Record --- 
            // Define initial status/stage for new versions (adjust as needed)
            const initialVersionStatus: VersionRoundStatus = VersionRoundStatus.WorkInProgress;
            const initialVersionStage: DesignStage = DesignStage.Sketch;
            
            const { data: newVersion, error: versionError } = await supabase
                .from('versions')
                .insert({ 
                    design_id: designId, 
                    version_number: newVersionNumber, 
                    status: initialVersionStatus,
                    stage: initialVersionStage 
                })
                .select()
                .single();

            if (versionError) {
                console.error("[AddVersion] Error creating new version record:", versionError);
                throw new Error(`Failed to create version ${newVersionNumber}: ${versionError.message}`);
            }
            if (!newVersion) throw new Error('Failed to create version, no data returned.');
            const newVersionId = newVersion.id;
            console.log(`[AddVersion] Created new version record: ${newVersionId} (V${newVersionNumber})`);

            // --- 3. Process Each File: Create Variation, Upload, Update --- 
            const variationResults = [];
            const bucketName = 'design-variations';
            const initialVariationStatus = 'Pending Feedback'; // Or derive from version status/stage?

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const variationLetter = String.fromCharCode(65 + i); // A, B, C...
                let createdVariationId = '';
                let finalFilePath = '';

                try {
                    // 3a. Create Variation Record
                    const { data: newVariation, error: variationError } = await supabase
                        .from('variations')
                        .insert({ 
                            version_id: newVersionId, 
                            variation_letter: variationLetter, 
                            status: initialVariationStatus
                            // file_path initially null
                        })
                        .select()
                        .single();

                    if (variationError) throw new Error(`Variation ${variationLetter} creation failed: ${variationError.message}`);
                    if (!newVariation) throw new Error(`Variation ${variationLetter} creation failed, no data returned.`);
                    createdVariationId = newVariation.id;
                    console.log(`[AddVersion] Created variation record: ${createdVariationId} (${variationLetter}) for V${newVersionNumber}`);

                    // 3b. Upload File
                    // Path: projects/{projectId}/designs/{designId}/versions/{newVersionId}/variations/{variationId}/{fileName}
                    finalFilePath = `projects/${projectId}/designs/${designId}/versions/${newVersionId}/variations/${createdVariationId}/${file.name}`;
                    console.log(`[AddVersion] Attempting upload to: ${finalFilePath}`);
                    
                    const { error: uploadError } = await supabase.storage
                        .from(bucketName)
                        .upload(finalFilePath, file, { upsert: true }); // Use upsert: true if replacing is acceptable on retry?

                    if (uploadError) throw new Error(`Storage upload failed for ${file.name}: ${uploadError.message}`);
                    console.log(`[AddVersion] Successfully uploaded ${file.name} to ${finalFilePath}`);

                    // 3c. Update Variation with File Path
                    const { error: updateError } = await supabase
                        .from('variations')
                        .update({ file_path: finalFilePath })
                        .eq('id', createdVariationId);

                    if (updateError) {
                         // Log warning but don't necessarily fail the whole batch?
                         console.warn(`[AddVersion] Failed to link ${finalFilePath} to variation ${createdVariationId}:`, updateError);
                         toast.warning(`File ${file.name} uploaded, but failed to link to variation record.`);
                    } else {
                        console.log(`[AddVersion] Successfully linked ${finalFilePath} to variation ${createdVariationId}`);
                    }
                    
                    variationResults.push({ variationId: createdVariationId, filePath: finalFilePath, fileName: file.name });
                    
                } catch (fileError: any) {
                    console.error(`[AddVersion] FAILED processing file ${i} (${file.name}):`, fileError);
                    // Rollback/cleanup attempts? Complex. For now, just report error.
                    // Maybe collect errors and report them all at the end?
                    // If one file fails, should the whole version creation fail? Let's say yes for now.
                    throw new Error(`Failed to process file ${file.name}: ${fileError.message}`); 
                    // Consider more granular error reporting / partial success later
                }
            }
            
            console.log(`[AddVersion] Successfully processed ${variationResults.length} files for V${newVersionNumber}.`);
            // Return info about the newly created version and its variations
            return { newVersion, variations: variationResults }; 

        },
        onSuccess: (data) => {
            // data = { newVersion, variations: [...] }
            toast.success(`Version ${data.newVersion.version_number} with ${data.variations.length} variation(s) added successfully!`);
            // Invalidate design details to refresh the modal
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] }); 
            // Optionally, invalidate the main design grid if its display depends on the *existence* of new versions
            queryClient.invalidateQueries({ queryKey: ['designs', projectId] }); 
            // Update state with the new version ID and first variation ID
            setCurrentVersionId(data.newVersion.id);
            if (data.variations && data.variations.length > 0) {
                 setCurrentVariationId(data.variations[0].variationId); // Correct property name
            } else {
                setCurrentVariationId(null); // Handle case with no variations (though unlikely here)
            }
        },
        onError: (error) => {
            toast.error(`Failed to add new version: ${error.message}`);
            // Consider specific cleanup or error state updates here
        },
    });
};

// --- NEW: Hook to Add Variations to an Existing Version ---
const useAddVariationsToVersion = (
    versionId: string, 
    designId: string, // Needed for invalidation and path construction
    projectId: string // Needed for path construction
) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    type AddVariationsPayload = {
        files: File[];
    };

    return useMutation({
        mutationFn: async ({ files }: AddVariationsPayload) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!versionId) throw new Error("Cannot add variations: No version selected.");
            if (!designId) throw new Error("Cannot add variations: Design ID missing.");
            if (!projectId) throw new Error("Cannot add variations: Project ID missing.");
            if (!files || files.length === 0) throw new Error("No files provided");

            console.log(`[AddVar] Starting process for ${files.length} files on version ${versionId}`);

            // --- 1. Determine Starting Variation Letter --- 
            const { data: existingVariations, error: fetchError } = await supabase
                .from('variations')
                .select('id') // Just need count or presence
                .eq('version_id', versionId);
            
            if (fetchError) {
                 console.error("[AddVar] Error fetching existing variations count:", fetchError);
                 throw new Error(`Failed to determine next variation letter: ${fetchError.message}`);
            }

            const existingVariationsCount = existingVariations?.length ?? 0;
            console.log(`[AddVar] Found ${existingVariationsCount} existing variations for version ${versionId}.`);

            // --- 2. Process Each File: Create Variation, Upload, Update --- 
            const results = [];
            const bucketName = 'design-variations';
            const initialVariationStatus = 'Pending Feedback'; // Consistent initial status

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                // Calculate letter based on existing count + current index
                const variationLetter = String.fromCharCode(65 + existingVariationsCount + i); 
                let createdVariationId = '';
                let finalFilePath = '';

                try {
                    // 2a. Create Variation Record
                    const { data: newVariation, error: variationError } = await supabase
                        .from('variations')
                        .insert({ 
                            version_id: versionId, 
                            variation_letter: variationLetter, 
                            status: initialVariationStatus
                        })
                        .select()
                        .single();

                    if (variationError) throw new Error(`Variation ${variationLetter} creation failed: ${variationError.message}`);
                    if (!newVariation) throw new Error(`Variation ${variationLetter} creation failed, no data returned.`);
                    createdVariationId = newVariation.id;
                    console.log(`[AddVar] Created variation record: ${createdVariationId} (${variationLetter}) for version ${versionId}`);

                    // 2b. Upload File
                    finalFilePath = `projects/${projectId}/designs/${designId}/versions/${versionId}/variations/${createdVariationId}/${file.name}`;
                    console.log(`[AddVar] Attempting upload to: ${finalFilePath}`);
                    
                    const { error: uploadError } = await supabase.storage
                        .from(bucketName)
                        .upload(finalFilePath, file, { upsert: true });

                    if (uploadError) throw new Error(`Storage upload failed for ${file.name}: ${uploadError.message}`);
                    console.log(`[AddVar] Successfully uploaded ${file.name} to ${finalFilePath}`);

                    // 2c. Update Variation with File Path
                    const { error: updateError } = await supabase
                        .from('variations')
                        .update({ file_path: finalFilePath })
                        .eq('id', createdVariationId);

                    if (updateError) {
                         console.warn(`[AddVar] Failed to link ${finalFilePath} to variation ${createdVariationId}:`, updateError);
                         toast.warning(`File ${file.name} uploaded, but failed to link to variation record.`);
                    } else {
                        console.log(`[AddVar] Successfully linked ${finalFilePath} to variation ${createdVariationId}`);
                    }
                    
                    results.push({ variationId: createdVariationId, filePath: finalFilePath, fileName: file.name });
                    
                } catch (fileError: any) {
                    console.error(`[AddVar] FAILED processing file ${i} (${file.name}):`, fileError);
                    throw new Error(`Failed to process file ${file.name}: ${fileError.message}`); 
                }
            }
            
            console.log(`[AddVar] Successfully processed ${results.length} files for version ${versionId}.`);
            return { addedVariations: results }; 

        },
        onSuccess: (data, variables) => {
            // data = { addedVariations: [...] }; variables = { files: [...] }
            toast.success(`${data.addedVariations.length} new variation(s) added successfully!`);
            // Invalidate design details to refresh the modal and show new variations
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] }); 
        },
        onError: (error) => {
            toast.error(`Failed to add new variations: ${error.message}`);
        },
    });
};

// --- NEW: Hook to Replace a Variation's File ---
const useReplaceVariationFile = (
    variationId: string,
    designId: string, // Needed for path construction and invalidation
    projectId: string // Needed for path construction
) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    type ReplaceVariationPayload = {
        file: File;
        // We might need the old file path if we want to delete the old one explicitly, 
        // but upsert should handle overwriting.
    };

    return useMutation({
        mutationFn: async ({ file }: ReplaceVariationPayload) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Cannot replace file: No variation selected.");
            if (!designId) throw new Error("Cannot replace file: Design ID missing.");
            if (!projectId) throw new Error("Cannot replace file: Project ID missing.");
            if (!file) throw new Error("No file provided for replacement.");

            console.log(`[ReplaceVar] Starting replacement for variation ${variationId} with file ${file.name}`);

            // --- 1. Determine Storage Path --- 
            // We need the version ID. We could pass it in, or fetch the variation details first.
            // Fetching is safer but adds latency. Let's assume we construct it for now, 
            // requiring versionId to be passed or available in scope where hook is used.
            // OR, fetch the variation to get its current file_path and version_id.
            const { data: variationData, error: fetchVarError } = await supabase
                .from('variations')
                .select('version_id, file_path')
                .eq('id', variationId)
                .single();

            if (fetchVarError || !variationData) {
                console.error("[ReplaceVar] Error fetching variation details:", fetchVarError);
                throw new Error(`Failed to get details for variation ${variationId}: ${fetchVarError?.message}`);
            }

            const versionId = variationData.version_id;
            // Construct the path using the fetched versionId. Use the NEW filename.
            const storagePath = `projects/${projectId}/designs/${designId}/versions/${versionId}/variations/${variationId}/${file.name}`;
            const bucketName = 'design-variations';
            console.log(`[ReplaceVar] Determined storage path: ${storagePath}`);

            // --- 2. Upload New File (Upsert) --- 
            const { error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(storagePath, file, { upsert: true });

            if (uploadError) {
                 console.error(`[ReplaceVar] Upload failed for ${file.name}:`, uploadError);
                 throw new Error(`Storage upload failed: ${uploadError.message}`);
            }
            console.log(`[ReplaceVar] Successfully uploaded ${file.name} to replace content at ${storagePath}`);

            // --- 3. Update Variation File Path (if filename changed) --- 
            // Check if the new path is different from the old one stored.
            if (variationData.file_path !== storagePath) {
                const { error: updateError } = await supabase
                    .from('variations')
                    .update({ file_path: storagePath, updated_at: new Date().toISOString() })
                    .eq('id', variationId);

                if (updateError) {
                    console.warn(`[ReplaceVar] File replaced in storage, but failed to update file_path in DB for ${variationId}:`, updateError);
                    toast.warning(`File replaced, but DB record update failed.`);
                    // Throw error here? Or allow partial success?
                    throw new Error(`Failed to update variation record: ${updateError.message}`);
                } else {
                    console.log(`[ReplaceVar] Successfully updated file_path for variation ${variationId}`);
                }
            } else {
                 console.log(`[ReplaceVar] File path unchanged, skipping DB update.`);
                 // Still might want to update the updated_at timestamp?
                 await supabase
                    .from('variations')
                    .update({ updated_at: new Date().toISOString() })
                    .eq('id', variationId);
            }

            return { variationId, newFilePath: storagePath };
        },
        onSuccess: (data) => {
            // data = { variationId, newFilePath }
            toast.success(`Variation file replaced successfully!`);
            // Invalidate design details to refresh the modal image viewer
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] }); 
        },
        onError: (error) => {
            toast.error(`Failed to replace variation file: ${error.message}`);
        },
    });
};

// --- NEW: Hook to Delete a Variation ---
const useDeleteVariation = (
    variationId: string,
    designId: string // Needed for invalidation
    // ProjectId not strictly needed for deletion itself, but good practice? Pass if needed.
) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!variationId) throw new Error("Cannot delete: No variation ID provided.");

            console.log(`[DeleteVar] Starting deletion for variation ${variationId}`);

            // --- 1. Get File Path --- 
            const { data: variationData, error: fetchVarError } = await supabase
                .from('variations')
                .select('file_path') // Only need the path for storage deletion
                .eq('id', variationId)
                .single();
            
            if (fetchVarError && fetchVarError.code !== 'PGRST116') { // Ignore 'not found' error if already deleted?
                console.error("[DeleteVar] Error fetching variation details:", fetchVarError);
                throw new Error(`Failed to get details for variation ${variationId}: ${fetchVarError?.message}`);
            }
            
            const filePath = variationData?.file_path;
            const bucketName = 'design-variations';

            // --- 2. Delete File from Storage (if path exists) --- 
            if (filePath) {
                console.log(`[DeleteVar] Attempting to delete file from storage: ${filePath}`);
                const { error: storageError } = await supabase.storage
                    .from(bucketName)
                    .remove([filePath]); // remove expects an array of paths

                if (storageError) {
                    // Log error but potentially continue to delete DB record?
                    // Or should failure here stop the process? Let's stop for now.
                    console.error("[DeleteVar] Error deleting file from storage:", storageError);
                    toast.error(`Failed to delete file from storage, aborting DB deletion.`); // More specific error
                    throw new Error(`Storage deletion failed: ${storageError.message}`);
                }
                 console.log(`[DeleteVar] Successfully deleted file from storage: ${filePath}`);
            } else {
                console.log("[DeleteVar] No file path found for variation, skipping storage deletion.");
            }

            // --- 3. Delete Variation Record from Database --- 
            const { error: dbError } = await supabase
                .from('variations')
                .delete()
                .eq('id', variationId);

            if (dbError) {
                console.error("[DeleteVar] Error deleting variation record from DB:", dbError);
                 // Attempted storage deletion might have succeeded, causing potential orphan?
                 // For now, just report DB error.
                throw new Error(`Failed to delete variation record: ${dbError.message}`);
            }
             console.log(`[DeleteVar] Successfully deleted variation record ${variationId} from DB.`);

            return { variationId }; // Return deleted ID for potential UI updates
        },
        onSuccess: (data) => {
            // data = { variationId }
            toast.success(`Variation deleted successfully!`);
            // Invalidate design details to refresh the modal (remove variation button, maybe change selected image)
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] }); 
            // Note: We might need more sophisticated logic here to select the *next* available variation 
            // if the currently selected one was deleted. The useEffect might handle this now.
        },
        onError: (error) => {
            toast.error(`Failed to delete variation: ${error.message}`);
        },
    });
};

export default function ProjectsOverviewPage() {
    const { supabase } = useAuth();
    const params = useParams();
    const router = useRouter();
    const queryClient = useQueryClient();

    const initialProjectId = params.projectId as string | undefined;
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId || null);
    const [isEditingProject, setIsEditingProject] = useState(false);
    const [editFormData, setEditFormData] = useState<Partial<Project>>({});
    const [uploadQueue, setUploadQueue] = useState<UploadingFileInfo[]>([]);

    // NEW: State for the Design Detail Modal
    const [isDesignModalOpen, setIsDesignModalOpen] = useState(false);
    const [selectedDesignIdForModal, setSelectedDesignIdForModal] = useState<string | null>(null);
    const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
    const [currentVariationId, setCurrentVariationId] = useState<string | null>(null);
    // NEW: State for comment input
    const [newCommentText, setNewCommentText] = useState('');

    // --- Refs for hidden file inputs ---
    const addVersionFileInputRef = useRef<HTMLInputElement>(null);
    const addVariationFileInputRef = useRef<HTMLInputElement>(null);
    const replaceVariationFileInputRef = useRef<HTMLInputElement>(null);

    // --- Form Hook for Add Design Dialog (Moved to Top Level) ---
    const {
        register: registerAddDesign, // Renamed for clarity
        handleSubmit: handleSubmitAddDesign, // Renamed for clarity
        reset: resetAddDesignForm, // Renamed for clarity
        formState: { errors: addDesignFormErrors }, // Renamed for clarity
    } = useForm<z.infer<typeof designSchema>>({
        resolver: zodResolver(designSchema),
        defaultValues: { name: '' },
    });

    // --- Queries ---
    const { data: allProjects, isLoading: isLoadingAllProjects, error: errorAllProjects } = useQuery<Pick<Project, 'id' | 'name' | 'status'>[]>({ 
        queryKey: ['projects', 'all'],
        queryFn: () => fetchAllProjects(supabase),
        enabled: !!supabase,
    });
    const { data: selectedProjectDetails, isLoading: isLoadingSelectedProject } = useQuery<Project | null>({
        queryKey: ['project', selectedProjectId],
        queryFn: () => fetchProject(supabase, selectedProjectId!),
        enabled: !!supabase && !!selectedProjectId, 
    });
    const { data: designsForSelectedProject, isLoading: isLoadingDesigns, error: errorDesigns } = useQuery<DesignGridItem[]>({ 
        queryKey: ['designs', selectedProjectId], 
        queryFn: () => fetchDesigns(supabase, selectedProjectId!),
        enabled: !!supabase && !!selectedProjectId, 
    });

    // NEW: Query for the selected design's details (for the modal)
    const { 
        data: designDetailsData,
        isLoading: isLoadingDesignDetails,
        error: errorDesignDetails,
        refetch: refetchDesignDetails // Function to manually refetch
    } = useQuery<DesignDetailsData | null>({
        queryKey: ['designDetails', selectedDesignIdForModal],
        queryFn: () => fetchDesignDetails(supabase, selectedDesignIdForModal!),
        enabled: !!supabase && !!selectedDesignIdForModal && isDesignModalOpen, // Only run when modal is open and ID is set
        staleTime: 5 * 60 * 1000, // Keep data fresh for 5 mins
        refetchOnWindowFocus: false, // Optional: prevent refetch on focus
    });

    // NEW: Query for comments on the selected variation
    const { 
        data: commentsData, 
        isLoading: isLoadingComments, 
        error: errorComments 
    } = useQuery<Comment[]>({ 
        queryKey: ['comments', currentVariationId], 
        queryFn: () => fetchCommentsForVariation(supabase, currentVariationId), 
        enabled: !!supabase && !!currentVariationId, // Only run if variation ID is available
        staleTime: 1 * 60 * 1000, // Comments can be slightly stale (1 min)
        refetchOnWindowFocus: true, // Refetch comments if window is refocused
    });

    // Effect to handle initial project selection based on URL or first project
    useEffect(() => {
        if (!selectedProjectId && !isLoadingAllProjects && allProjects && allProjects.length > 0) {
            // If no project selected (and not loading projects) and projects exist,
            // select the one from URL if valid, otherwise select the first project in the list.
            const projectFromUrl = allProjects.find(p => p.id === initialProjectId);
            setSelectedProjectId(projectFromUrl ? projectFromUrl.id : allProjects[0].id);
        }
    }, [selectedProjectId, isLoadingAllProjects, allProjects, initialProjectId]);

    // Effect to set initial/default version/variation when modal data loads
    useEffect(() => {
        if (designDetailsData?.versions && designDetailsData.versions.length > 0) {
            // Check if the currently selected version is still valid in the new data
            const currentVersionExists = currentVersionId && designDetailsData.versions.some(v => v.id === currentVersionId);

            // Only set default if no version is selected OR the selected one is no longer valid
            if (!currentVersionExists) {
                const targetVersion = designDetailsData.versions[0]; // Default to first version (which will be V1 after order change)
                setCurrentVersionId(targetVersion.id);
                // When version changes, default variation
                if (targetVersion.variations && targetVersion.variations.length > 0) {
                    setCurrentVariationId(targetVersion.variations[0].id); // Default to first variation (A)
                } else {
                    setCurrentVariationId(null);
                }
            } else {
                // If current version IS still valid, ensure current variation is also valid within that version
                const currentVersionData = designDetailsData.versions.find(v => v.id === currentVersionId);
                const currentVariationExists = currentVariationId && currentVersionData?.variations.some(va => va.id === currentVariationId);
                if (!currentVariationExists && currentVersionData?.variations && currentVersionData.variations.length > 0) {
                    // If current variation is invalid, set to first variation of current version
                     setCurrentVariationId(currentVersionData.variations[0].id);
                } else if (!currentVariationExists) {
                    // If current variation is invalid and version has NO variations, set to null
                    setCurrentVariationId(null);
                }
                 // Otherwise, keep the current valid variation selected
            }
        } else {
             // No versions found, reset state
            setCurrentVersionId(null);
            setCurrentVariationId(null);
        }
        // Dependency array: Only re-run when the fetched data itself changes. 
        // User clicks will handle setting state directly via handleVersionChange/handleVariationChange.
    }, [designDetailsData]); // Removed currentVersionId from dependencies

    // --- Mutations ---
    const addDesignMutation = useAddDesign(selectedProjectId || ''); 
    const createDesignFromUploadMutation = useCreateDesignFromUpload(selectedProjectId || '', setUploadQueue);
    const updateProjectDetailsMutation = useUpdateProjectDetails(selectedProjectId || '');
    const addCommentMutation = useAddComment(selectedDesignIdForModal || '', currentVariationId || '');
    // NEW: Instantiate version update hook
    const updateVersionDetailsMutation = useUpdateVersionDetails(
        currentVersionId || '', 
        selectedDesignIdForModal || '', 
        selectedProjectId || null // Pass projectId
    ); 
    // NEW: Instantiate version with variations hook (moved inside component)
    const addVersionWithVariationsMutation = useAddVersionWithVariations(
        selectedDesignIdForModal || '', 
        selectedProjectId || '',
        // Provide setters to update state on success
        setCurrentVersionId, 
        setCurrentVariationId 
    );
    // NEW: Instantiate add variations to version hook
    const addVariationsToVersionMutation = useAddVariationsToVersion(
        currentVersionId || '',
        selectedDesignIdForModal || '',
        selectedProjectId || ''
    );
    // NEW: Instantiate replace variation file hook
    const replaceVariationFileMutation = useReplaceVariationFile(
        currentVariationId || '',
        selectedDesignIdForModal || '',
        selectedProjectId || ''
    );
    // NEW: Instantiate delete variation hook
    const deleteVariationMutation = useDeleteVariation(
        currentVariationId || '',
        selectedDesignIdForModal || ''
        // Removed projectId as it's not defined in the hook's parameters
    );
    // NEW: Instantiate variation update hook
    const updateVariationDetailsMutation = useUpdateVariationDetails(
        currentVariationId || '', 
        selectedDesignIdForModal || '',
        selectedProjectId || null // Pass the currently selected projectId
    );

    // --- Handlers ---
    const handleSelectProject = (projectId: string) => {
        setSelectedProjectId(projectId);
    };

    // Updated handler to use the form hook defined above
    const handleAddDesignSubmit = (values: z.infer<typeof designSchema>) => {
        if (!selectedProjectId) {
            toast.error("Please select a project first.");
            return;
        }
        // Call mutation, onSuccess/onError can be added here for dialog-specific actions
        addDesignMutation.mutate(values, {
             onSuccess: () => {
                 resetAddDesignForm(); // Reset the correct form
                 // Optionally close dialog if needed, depends on Dialog structure
                 // setIsAddDesignDialogOpen(false); // Example if state controlled
            }
        });
    };

    // Corrected Dropzone prop
    const handleDrop = useCallback(
        (acceptedFiles: File[]) => {
            if (!selectedProjectId) {
                 toast.error("Please select a project before uploading designs.");
                 return;
            }
             console.log('Dropped files:', acceptedFiles, 'for project:', selectedProjectId);
             if (acceptedFiles.length > 0) {
                // For now, still handling only the first file for the demo upload
                const file = acceptedFiles[0];
                const fileId = Date.now().toString(); 
                setUploadQueue([{ 
                    id: fileId,
                    file,
                    previewUrl: URL.createObjectURL(file),
                    status: 'pending', 
                    progress: 0,
                    uploadStarted: false 
                }]);
                createDesignFromUploadMutation.mutate({ file, fileId });
             }
        },
        [selectedProjectId, createDesignFromUploadMutation] 
    );

    // ... (Keep other handlers: handleCancelUpload, startUpload, handleProjectEditClick, handleProjectCancelClick, handleProjectSaveClick)
     const handleCancelUpload = (id: string) => { /* TODO */ };
     const startUpload = (id: string) => { /* TODO */ };
     const handleProjectEditClick = () => { /* TODO */ };
     const handleProjectCancelClick = () => { /* TODO */ };
     const handleProjectSaveClick = () => { /* TODO */ };

    // MODIFIED: Handler for clicking a design card - now opens modal
    const handleDesignClick = (designId: string) => {
        console.log(`Opening modal for design: ${designId}`);
        setSelectedDesignIdForModal(designId);
        // Reset version/variation state when opening a new design
        setCurrentVersionId(null);
        setCurrentVariationId(null);
        setIsDesignModalOpen(true);
    };

    // Handler for closing the modal (resets selected ID)
    const handleModalOpenChange = (open: boolean) => {
        setIsDesignModalOpen(open);
        if (!open) {
            setSelectedDesignIdForModal(null); // Clear selection on close
        }
    };
    
    // Helper to find the currently selected version object
    const currentVersion = designDetailsData?.versions.find(v => v.id === currentVersionId);
    // Helper to find the currently selected variation object
    const selectedVariation = currentVersion?.variations.find(va => va.id === currentVariationId);

    // Handler for changing version in the modal
    const handleVersionChange = (versionId: string) => {
        const selectedVersion = designDetailsData?.versions.find(v => v.id === versionId);
        if (selectedVersion) {
            setCurrentVersionId(versionId);
            // Automatically select the first variation of the new version
            if (selectedVersion.variations && selectedVersion.variations.length > 0) {
                setCurrentVariationId(selectedVersion.variations[0].id);
            } else {
                setCurrentVariationId(null);
            }
        }
    };

    // Handler for changing variation in the modal
    const handleVariationChange = (variationId: string) => {
        setCurrentVariationId(variationId);
    };

    // --- NEW: Handler to trigger file input for Add Version ---
    const handleAddNewVersionClick = () => {
        if (!selectedDesignIdForModal) {
            toast.error("Cannot add version: No design selected.");
            return;
        }
        // Trigger the hidden file input
        addVersionFileInputRef.current?.click(); 
    };

    // --- NEW: Handler for when files are selected for a new version ---
    const handleVersionFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!selectedDesignIdForModal) {
             toast.error("Error: Design context lost during file selection.");
             return;
        }
        const files = event.target.files;
        if (files && files.length > 0) {
            console.log(`[AddVersion] Files selected:`, files);
            // Convert FileList to Array and call the mutation
            addVersionWithVariationsMutation.mutate({ files: Array.from(files) });
        } else {
            console.log("[AddVersion] No files selected.");
        }
        // Reset file input value to allow selecting the same file again
        if (event.target) {
            event.target.value = '';
        }
    };

    // --- NEW: Handler to trigger file input for Add Variation ---
    const handleAddNewVariationClick = () => {
        if (!currentVersionId) {
            toast.error("Cannot add variation: No version selected.");
            return;
        }
        // Trigger the hidden file input
        addVariationFileInputRef.current?.click(); 
    };

    // --- NEW: Handler for when files are selected for a new variation ---
    const handleVariationFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!currentVersionId) {
             toast.error("Error: Version context lost during file selection.");
             return;
        }
        const files = event.target.files;
        if (files && files.length > 0) {
            console.log(`[AddVar] Files selected:`, files);
            // Convert FileList to Array and call the mutation
            addVariationsToVersionMutation.mutate({ files: Array.from(files) });
        } else {
            console.log("[AddVar] No files selected.");
        }
        // Reset file input value
        if (event.target) {
            event.target.value = '';
        }
    };

    // --- NEW: Handler to trigger file input for Replace Variation ---
    const handleReplaceVariationClick = () => {
        console.log("[ReplaceVar] Button clicked. Current Variation ID:", currentVariationId);
        if (!currentVariationId) {
            toast.error("Cannot replace file: No variation selected.");
            return;
        }
        console.log("[ReplaceVar] File input ref:", replaceVariationFileInputRef.current);
        // Trigger the hidden file input
        replaceVariationFileInputRef.current?.click(); 
    };

    // --- NEW: Handler for when a file is selected for replacement ---
    const handleReplaceFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!currentVariationId) {
             toast.error("Error: Variation context lost during file selection.");
             return;
        }
        const file = event.target.files?.[0]; // Only handle single file replacement
        if (file) {
            console.log(`[ReplaceVar] File selected for replacement:`, file);
            replaceVariationFileMutation.mutate({ file });
        } else {
            console.log("[ReplaceVar] No file selected.");
        }
        // Reset file input value
        if (event.target) {
            event.target.value = '';
        }
    };

    // --- NEW: Handler for deleting the current variation ---
    const handleDeleteVariationClick = () => {
        if (!currentVariationId) {
            toast.error("Cannot delete: No variation selected.");
            return;
        }
        const variationLetter = selectedVariation?.variation_letter || 'this variation'; // Get letter for prompt
        if (window.confirm(`Are you sure you want to permanently delete variation ${variationLetter}? This cannot be undone.`)) {
            console.log(`[DeleteVar] Confirmed deletion for variation ${currentVariationId}`);
            deleteVariationMutation.mutate(); // No payload needed for the delete mutation itself
        }
    };

    // --- Render ---
    if (isLoadingAllProjects) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /> Loading Projects...</div>;
    }
    if (errorAllProjects) {
        return <div className="p-4 text-red-600">Error loading projects: {errorAllProjects.message}</div>;
    }

    // Define breadcrumb items (now more generic or based on selected project)
    const breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Projects', href: '/projects' }, 
        ...(selectedProjectDetails ? [{ label: selectedProjectDetails.name }] : []) 
    ];

    return (
        <div className="container mx-auto p-4 flex gap-6"> 
            {/* --- Sidebar --- */}
            <aside className="w-64 flex-shrink-0 border-r pr-6"> 
                 <h2 className="text-xl font-semibold mb-4">Projects</h2>
                 <nav className="space-y-1">
                     {allProjects?.map((project) => (
                         <button
                            key={project.id}
                            onClick={() => handleSelectProject(project.id)}
                            className={cn(
                                "w-full text-left px-3 py-2 rounded-md text-sm font-medium flex justify-between items-center",
                                selectedProjectId === project.id
                                    ? 'bg-muted text-primary' 
                                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                            )}
                        >
                            <span>{project.name}</span>
                            <Badge variant={selectedProjectId === project.id ? "default" : "outline"} className="text-xs">{project.status}</Badge>
                        </button>
                     ))}
                     {(!allProjects || allProjects.length === 0) && (
                        <p className="text-sm text-muted-foreground italic">No projects found.</p>
                     )}
                 </nav>
             </aside>

            {/* --- Main Content Area --- */}
            <main className="flex-grow min-w-0"> 
                 <Breadcrumbs items={breadcrumbItems} />
                 
                {!selectedProjectId ? (
                    <div className="mt-6 text-center text-muted-foreground">Select a project to view details.</div>
                ) : isLoadingSelectedProject || isLoadingDesigns ? (
                    <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /> Loading project data...</div>
                ) : errorDesigns ? (
                     <div className="mt-6 text-red-600">Error loading designs: {errorDesigns.message}</div>
                ) : selectedProjectDetails ? (
                     <> 
                        <div className="flex justify-between items-center mb-6 mt-4">
                            <h1 className="text-3xl font-bold">{selectedProjectDetails.name}</h1>
                        </div>
                        <p className="text-muted-foreground mb-2">Status: <Badge variant="secondary">{selectedProjectDetails.status}</Badge></p>
                        <p className="mb-6">{selectedProjectDetails.description || <span className="italic text-muted-foreground">No description.</span>}</p>

                        <Card className="mb-6">
                            <CardHeader>
                                <CardTitle>Upload New Designs</CardTitle>
                                <CardDescription>Drag & drop files here to create new designs in this project.</CardDescription>
                </CardHeader>
                <CardContent>
                                <Dropzone onFilesAccepted={handleDrop} /> 
                                {uploadQueue.map(item => (
                                    <div key={item.id}>...display file item...</div>
                                ))}
                </CardContent>
            </Card>

                        
                        
                        {/* Design Grid Area - Keep this heading as it's next to the button */}
                        <div className="flex justify-between items-center mb-4 mt-6">
                            <h2 className="text-2xl font-semibold">Designs</h2>
                            <Dialog>
                        <DialogTrigger asChild>
                            <Button size="sm">
                                        <PlusCircle className="mr-2 h-4 w-4" /> Add Design Manually
                            </Button>
                        </DialogTrigger>
                                <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Add New Design</DialogTitle>
                                        <DialogDescription>Enter a name for the new design.</DialogDescription>
                            </DialogHeader>
                                    <form onSubmit={handleSubmitAddDesign(handleAddDesignSubmit)} className="space-y-4">
                                <div className="space-y-1">
                                            <Label htmlFor="designName">Design Name</Label>
                                            <Input id="designName" {...registerAddDesign("name")} />
                                            {addDesignFormErrors.name && <p className="text-xs text-red-600">{addDesignFormErrors.name.message}</p>}
                                </div>
                                <DialogFooter>
                                            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                                    <Button type="submit" disabled={addDesignMutation.isPending}>
                                                {addDesignMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Add Design
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                        </div>
                        
                        {/* Replace Table with Design Card Grid */}
                        {designsForSelectedProject && designsForSelectedProject.length > 0 ? (
                             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {designsForSelectedProject.map((design) => (
                                    <DesignCard 
                                        key={design.id} 
                                        design={design} 
                                        // onClick now opens modal
                                        onClick={() => handleDesignClick(design.id)} 
                                    />
                                ))}
                             </div>
                        ) : (
                             <div className="text-center text-muted-foreground py-10 border rounded-md">
                                 No designs found for this project yet.
                             </div>
                        )}
                    </> 
                ) : (
                     <div className="mt-6 text-center text-muted-foreground">Project not found or failed to load.</div>
                )}
                
                {/* --- Design Detail Modal --- */}
                <Dialog open={isDesignModalOpen} onOpenChange={handleModalOpenChange}>
                   <DialogPortal>
                        {/* Hidden File Inputs - Moved outside content for stable refs */} 
                        <input 
                            type="file"
                            ref={addVersionFileInputRef}
                            onChange={handleVersionFilesSelected}
                            className="hidden"
                            multiple 
                            accept="image/*" 
                        />
                         <input 
                            type="file"
                            ref={addVariationFileInputRef}
                            onChange={handleVariationFilesSelected}
                            className="hidden"
                            multiple 
                            accept="image/*" 
                        />
                        <input 
                            type="file"
                            ref={replaceVariationFileInputRef}
                            onChange={handleReplaceFileSelected}
                            className="hidden"
                            accept="image/*" 
                        />

                        <DialogOverlay className="bg-black/50" /> 
                        <DialogContent className="p-0 h-[90vh] flex flex-col w-full max-w-full sm:max-w-[95vw] xl:max-w-screen-xl"> {/* Wider max-width */} 
                            <DialogHeader className="p-4 border-b shrink-0 flex flex-row justify-between items-center"> {/* Keep Header Flex */} 
                                {/* Wrap Title ONLY */} 
                                <div className="flex items-center gap-4"> 
                                     <DialogTitle>{designDetailsData?.name || 'Loading Design...'}</DialogTitle>
                                     <DialogDescription className="sr-only">View and manage design versions and variations.</DialogDescription>
                                </div>
                                {/* Close button will implicitly be pushed right */} 
                            </DialogHeader>
                            
                            {/* Main Content Area - Grid for Image/Nav(Left) and Comments(Right) */} 
                            {/* Changed grid ratio to 5fr/2fr */}
                            <div className="grid grid-cols-[5fr_2fr] flex-grow overflow-hidden"> 

                                {/* Left Side (Nav + Image) */} 
                                <div className="grid grid-rows-[auto_1fr] overflow-hidden">
                                    {/* Version/Variation Navigation */} 
                                    {/* Reduced padding to px-2 pt-1 pb-2 */}
                                    <nav className="px-2 pt-1 pb-2 border-b overflow-y-auto max-h-[35vh]">
                                        {/* --- Version Section --- */} 
                                        {/* Removed pb-2 for consistency */}
                                        <div className="mb-2 border-b"> 
                                            <div className="flex justify-between items-center mb-1"> 
                                                <h4 className="text-sm font-medium">Version</h4>
                                                {/* Removed the container div and the Select */} 
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 mt-2"> {/* Added items-center */} 
                                                {designDetailsData?.versions.map((version) => {
                                                    const stage = version.stage; // Use temp var if needed for linter
                                                    return (
                                                        <Button
                                                            key={version.id}
                                                            variant={currentVersionId === version.id ? 'default' : 'outline'}
                                                            // size="sm" // Removed size
                                                            onClick={() => handleVersionChange(version.id)}
                                                            // Added explicit sizing, kept existing classes
                                                            className={cn(
                                                                "h-auto py-1 px-2 text-xs min-w-[4rem] relative pr-5 group", 
                                                                currentVersionId !== version.id && "border" // Ensure outline gets border
                                                            )}
                                                        >
                                                            V{version.version_number}
                                                            {stage && (
                                                                <Badge
                                                                    variant="secondary"
                                                                    className={cn(
                                                                        "absolute -top-1 -right-1 px-1 py-0 text-xs leading-tight rounded-full transition-opacity group-hover:opacity-100",
                                                                        stage === DesignStage.Sketch && "bg-gray-200 text-gray-800",
                                                                        stage === DesignStage.Refine && "bg-yellow-200 text-yellow-800",
                                                                        stage === DesignStage.Color && "bg-blue-200 text-blue-800",
                                                                        stage === DesignStage.Final && "bg-green-200 text-green-800"
                                                                    )}
                                                                    title={stage}
                                                                >
                                                                    {stage.charAt(0).toUpperCase()}
                                                                </Badge>
                                                            )}
                                                        </Button>
                                                    );
                                                })}
                                                {/* Add Version Button */}
                                                <Button
                                                    variant="outline"
                                                    // Removed size="sm"
                                                    // Removed p-2, added explicit sizing + ml-2
                                                    className="h-auto py-1 px-2 ml-2"
                                                    onClick={handleAddNewVersionClick}
                                                    title="Add New Version"
                                                >
                                                    <PlusCircle className="h-4 w-4" />
                                                </Button>
                                                {/* --- MOVED Stage Select Here --- */}
                                                {currentVersion && (
                                                    <div className="flex items-center gap-1 ml-auto"> {/* Use ml-auto to push right */} 
                                                        <Select 
                                                            value={currentVersion.stage || ''} 
                                                            onValueChange={(newStage) => { 
                                                                if (currentVersion.status) { 
                                                                    updateVersionDetailsMutation.mutate({
                                                                        stage: newStage as DesignStage,
                                                                        status: currentVersion.status 
                                                                    });
                                                                } else {
                                                                    toast.error("Cannot update stage: Current status is missing.")
                                                                }
                                                            }}
                                                            disabled={!currentVersion || updateVersionDetailsMutation.isPending} 
                                                        >
                                                            <SelectTrigger className="w-[100px] h-7 text-xs">
                                                                <SelectValue placeholder="Stage..." />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {Object.values(DesignStage).map((stage) => (
                                                                    <SelectItem key={stage} value={stage} className="text-xs capitalize">
                                                                        {stage}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        {/* Loader during mutation */} 
                                                        {updateVersionDetailsMutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />} 
                                                    </div>
                                                )}
                                                {/* --- End Moved Stage Select --- */}
                                                {(!designDetailsData?.versions || designDetailsData.versions.length === 0) && (
                                                    <p className="text-xs text-muted-foreground italic">No versions found.</p>
                                                )}
                                            </div>
                                        </div>

                                        {/* --- Variation Section --- */} 
                                        {/* Reduced margin to mt-2 */}
                                        <div className="mt-2"> 
                                            {/* Reduced margin to mb-1 */} 
                                            <h4 className="text-sm font-medium mb-1">Variations for V{currentVersion?.version_number}</h4> 
                                            {/* Reduced margin to mt-2 */}
                                            <div className="flex flex-wrap items-center gap-2 mt-2"> 
                                                {currentVersion?.variations.map((variation, index) => {
                                                    const displayLetter = String.fromCharCode(65 + index); // Calculate A, B, C...
                                                    return (
                                                        <Button 
                                                            key={variation.id} 
                                                            variant={currentVariationId === variation.id ? 'default' : 'outline'}
                                                            // size="sm" // Removed size
                                                            onClick={() => handleVariationChange(variation.id)}
                                                            // Added explicit sizing, kept existing classes
                                                            className={cn(
                                                                "h-auto py-1 px-2 text-xs min-w-[3rem]",
                                                                currentVariationId !== variation.id && "border" // Ensure outline gets border
                                                            )}
                                                        >
                                                            {displayLetter}
                                                        </Button>
                                                    );
                                                })}
                                                {/* Add Variation Button */} 
                                                <Button 
                                                    variant="outline" 
                                                    // Removed size="sm"
                                                    // Removed p-2, added explicit sizing + ml-2
                                                    className="h-auto py-1 px-2 ml-2" 
                                                    onClick={handleAddNewVariationClick}
                                                    title="Add New Variation"
                                                >
                                                    <PlusCircle className="h-4 w-4" />
                                                </Button>
                                                {(!currentVersion?.variations || currentVersion.variations.length === 0) && (
                                                    <p className="text-xs text-muted-foreground italic">No variations for this version.</p>
                                                )}
                                            </div>
                                        </div>
                                        {/* --- End of Variation Section --- */} 
                                    </nav>

                                    {/* Image Viewer Area - Added relative positioning and group */} 
                                    {/* Reduced padding to p-2 */}
                                    <div className="p-2 flex items-center justify-center overflow-hidden h-full relative group/imageViewer"> 
                                         {isLoadingDesignDetails ? (
                                             <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                                         ) : errorDesignDetails ? (
                                             <div className="text-red-600">Error loading image area.</div>
                                         ) : designDetailsData ? (
                                             <ModalImageViewer filePath={selectedVariation?.file_path} />
                                         ) : (
                                             <div>No image data.</div>
                                         )}
                                         {/* Replace Button Overlay - Appears on hover */} 
                                         {selectedVariation?.file_path && (
                                             <Button 
                                                 variant="outline" 
                                                 size="icon" 
                                                 className="absolute bottom-2 right-2 z-10 opacity-0 group-hover/imageViewer:opacity-80 hover:!opacity-100 transition-opacity bg-background/70 hover:bg-background/90"
                                                 onClick={handleReplaceVariationClick}
                                                 title="Replace Variation Image"
                                                 disabled={replaceVariationFileMutation.isPending} // Disable while replacing
                                             >
                                                 {replaceVariationFileMutation.isPending 
                                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                                    : <RefreshCw className="h-4 w-4" /> // Changed Icon
                                                 } 
                                             </Button>
                                         )}
                                         {/* Delete Button Overlay */} 
                                         <Button 
                                             variant="destructive" // Destructive variant for delete
                                             size="icon" 
                                             className="absolute bottom-2 right-12 z-10 opacity-0 group-hover/imageViewer:opacity-80 hover:!opacity-100 transition-opacity bg-destructive/70 hover:bg-destructive/90 p-1.5" // Adjusted position (right-12), added padding
                                             onClick={handleDeleteVariationClick}
                                             title="Delete Variation"
                                             disabled={deleteVariationMutation.isPending} // Disable while deleting
                                         >
                                             {deleteVariationMutation.isPending 
                                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                                : <Trash2 className="h-4 w-4" /> // Trash icon
                                             } 
                                         </Button>
                                    </div>
                                </div>
                                
                                {/* Right Side (Details & Comments) */} 
                                <aside className="border-l overflow-y-auto flex flex-col">
                                    {isLoadingDesignDetails ? (
                                        <div className="p-4 text-center"><Loader2 className="h-6 w-6 animate-spin inline-block" /></div>
                                    ) : errorDesignDetails ? (
                                        <div className="p-4 text-red-600">Error loading sidebar.</div>
                                    ) : designDetailsData ? (
                                        <div className="flex-grow flex flex-col"> {/* Allow comments to grow */} 
                                            {/* Details Section */} 
                                            {/* Reduced padding to p-2 */}
                                            <div className="p-2 border-b shrink-0"> 
                                                 {/* Reduced margin to mb-1 */}
                                                 <h4 className="text-base font-semibold mb-1">Details</h4>
                                                 {/* Variation Details */}
                                                 <p className="text-xs text-muted-foreground mb-1">Variation Status:</p>
                                                 {/* Reduced margin to mb-2 */}
                                                 <Badge variant={selectedVariation?.status === 'Rejected' ? 'destructive' : 'secondary'} className="mb-2">
                                                      {selectedVariation?.status || 'N/A'}
                                                 </Badge>

                                                 {/* --- UPDATED: Variation Status Update Buttons --- */}
                                                 {/* Reduced margin/padding to mt-2/pt-2 */}
                                                 <div className="mt-2 border-t pt-2">
                                                      {/* Reduced margin to mb-1 */}
                                                      <h5 className="text-xs font-semibold mb-1 text-muted-foreground uppercase">Update Variation Status</h5>
                                                      <div className="flex flex-row items-center gap-2">
                                                          {/* Approve Button */}
                                                          <Button 
                                                              variant="default" 
                                                              // size="sm" // Removed size
                                                              className="bg-green-600 hover:bg-green-700 text-primary-foreground h-auto py-1 px-2 text-xs" // Reinstated explicit sizing
                                                              title="Approve this variation" 
                                                              onClick={() => {
                                                                  updateVariationDetailsMutation.mutate({ 
                                                                      status: VariationFeedbackStatus.Approved 
                                                                  });
                                                              }}
                                                              disabled={!currentVariationId || updateVariationDetailsMutation.isPending || selectedVariation?.status === VariationFeedbackStatus.Approved}
                                                          >
                                                              Approve
                                                          </Button>
                                                          {/* Needs Changes Button */}
                                                          <Button 
                                                              variant="default" 
                                                              // size="sm" // Removed size
                                                              className="bg-orange-500 hover:bg-orange-600 text-primary-foreground h-auto py-1 px-2 text-xs" // Reinstated explicit sizing
                                                              title="Request changes for this variation" 
                                                              onClick={() => {
                                                                  updateVariationDetailsMutation.mutate({ 
                                                                      status: VariationFeedbackStatus.NeedsChanges 
                                                                  });
                                                              }}
                                                              disabled={!currentVariationId || updateVariationDetailsMutation.isPending || selectedVariation?.status === VariationFeedbackStatus.NeedsChanges}
                                                          >
                                                              Changes {/* Shorter Label */}
                                                          </Button>
                                                          {/* Request Feedback Button */}
                                                          <Button 
                                                              variant="secondary" 
                                                              // size="sm" // Removed size
                                                              className="h-auto py-1 px-2 text-xs" // Reinstated explicit sizing
                                                              title="Set status to Pending Feedback" 
                                                              onClick={() => {
                                                                  updateVariationDetailsMutation.mutate({ 
                                                                      status: VariationFeedbackStatus.PendingFeedback 
                                                                  });
                                                              }}
                                                              disabled={!currentVariationId || updateVariationDetailsMutation.isPending || selectedVariation?.status === VariationFeedbackStatus.PendingFeedback}
                                                          >
                                                              Feedback {/* Shorter Label */}
                                                          </Button>
                                                          {/* Reject Button */}
                                                          <Button 
                                                              variant="destructive" 
                                                              // size="sm" // Removed size
                                                              className="h-auto py-1 px-2 text-xs" // Reinstated explicit sizing
                                                              title="Reject this variation" 
                                                              onClick={() => {
                                                                  updateVariationDetailsMutation.mutate({ 
                                                                      status: VariationFeedbackStatus.Rejected 
                                                                  });
                                                              }}
                                                              disabled={!currentVariationId || updateVariationDetailsMutation.isPending || selectedVariation?.status === VariationFeedbackStatus.Rejected}
                                                          >
                                                              Reject
                                                          </Button>
                                                          {/* Loader */}
                                                          {updateVariationDetailsMutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground self-center" />} 
                                                      </div>
                                                 </div>
                                                 {/* --- End Variation Status Buttons --- */}
                                            </div>

                                            {/* Comments Panel */}
                                            {/* Reduced padding to p-2 */}
                                            <div className="p-2 flex-grow flex flex-col bg-gray-50 overflow-hidden"> 
                                                {/* Reduced margin to mb-1 */}
                                                <h4 className="text-base font-semibold mb-1 shrink-0">Comments</h4>
                                                {/* Reduced margin to mb-2 */}
                                                <div className="flex-grow overflow-y-auto mb-2 border-t border-b -mx-2 px-2"> {/* Adjusted negative margin */}
                                                    {isLoadingComments ? (
                                                        <div className="flex justify-center items-center h-full">
                                                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                                        </div>
                                                    ) : errorComments ? (
                                                        <div className="text-center text-red-500 py-4">Error loading comments.</div>
                                                    ) : commentsData && commentsData.length > 0 ? (
                                                        commentsData.map((comment) => (
                                                            <CommentCard key={comment.id} comment={comment} />
                                                        ))
                                                    ) : (
                                                        <p className="text-sm text-muted-foreground italic text-center py-4">No comments yet.</p>
                                                    )}
                                                </div>
                                                {/* Comment Input Area */} 
                                                <div className="mt-auto shrink-0"> 
                                                     <Textarea 
                                                         placeholder="Add your comment..." 
                                                         className="mb-2" 
                                                         value={newCommentText} 
                                                         onChange={(e) => setNewCommentText(e.target.value)} 
                                                         rows={3}
                                                     />
                                                     <Button 
                                                         size="sm" 
                                                         onClick={() => {
                                                             if (newCommentText.trim()) {
                                                                 addCommentMutation.mutate(newCommentText, {
                                                                      onSuccess: () => setNewCommentText('') // Clear input on success
                                                                 });
                                                             } else {
                                                                 toast.info("Comment cannot be empty.");
                                                             }
                                                         }}
                                                         disabled={!currentVariationId || addCommentMutation.isPending} // Disable if no variation or pending
                                                     >
                                                         {addCommentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Send
                                                     </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-4">No details available.</div>
                                    )}
                                </aside>
                            </div>
                        </DialogContent>
                    </DialogPortal>
                </Dialog>
            </main>
        </div>
    );
} 