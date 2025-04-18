'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, Pencil, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
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
    VersionRoundStatus
} from '@/types/models';
import { ModalImageViewer } from '@/components/modal/ModalImageViewer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
        .order('version_number', { referencedTable: 'versions', ascending: false }) // Order versions desc
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
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (commentText: string) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!designId) throw new Error("Design ID is required");
            if (!variationId) throw new Error("Variation ID is required");
            if (!commentText?.trim()) throw new Error("Comment text cannot be empty");

            const insertData = {
                design_id: designId,
                variation_id: variationId,
                text: commentText.trim(),
                // Add other fields as needed
            };

            const { data, error } = await supabase
                .from('comments')
                .insert(insertData)
                .select()
                .single();

            if (error) {
                console.error('Error adding comment:', error);
                throw new Error(`Failed to add comment: ${error.message}`);
            }
            return data;
        },
        onSuccess: (data) => {
            toast.success(`Comment added successfully!`);
            queryClient.invalidateQueries({ queryKey: ['comments', designId, variationId] }); 
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- NEW: Hook to Update VERSION Details (Stage/Status) ---
const useUpdateVersionDetails = (versionId: string, designId: string) => { // Need designId for invalidation
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
            toast.success(`Version ${data.version_number} updated successfully!`);
            // Invalidate design details to refetch version data
            queryClient.invalidateQueries({ queryKey: ['designDetails', designId] }); 
            // We might also need to invalidate the grid if its display depends on latest version status
            // Assuming the RPC handles fetching the latest stage/status correctly, invalidating 
            // the project's designs list might be needed IF the definition of "latest" changes due to status.
            // For now, let's rely on designDetails invalidation.
            queryClient.invalidateQueries({ queryKey: ['designs', data.project_id] }); 
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
    // NEW: State for editing VERSION stage/status
    const [isEditingVersionDetails, setIsEditingVersionDetails] = useState(false);
    const [editingVersionStage, setEditingVersionStage] = useState<DesignStage | null>(null);
    const [editingVersionStatus, setEditingVersionStatus] = useState<VersionRoundStatus | null>(null);

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
            const latestVersion = designDetailsData.versions[0]; // Already ordered desc
            if (currentVersionId !== latestVersion.id) { // Only set if different or null
                setCurrentVersionId(latestVersion.id);
                // When version changes (or loads initially), default variation
                if (latestVersion.variations && latestVersion.variations.length > 0) {
                    setCurrentVariationId(latestVersion.variations[0].id); // Already ordered asc
                } else {
                    setCurrentVariationId(null);
                }
            }
        } else {
            setCurrentVersionId(null);
            setCurrentVariationId(null);
        }
        // Dependency array includes currentVersionId to prevent loops but allow reset if data changes
    }, [designDetailsData, currentVersionId]); 

    // --- Mutations ---
    const addDesignMutation = useAddDesign(selectedProjectId || ''); 
    const createDesignFromUploadMutation = useCreateDesignFromUpload(selectedProjectId || '', setUploadQueue);
    const updateProjectDetailsMutation = useUpdateProjectDetails(selectedProjectId || '');
    const addCommentMutation = useAddComment(selectedDesignIdForModal || '', currentVariationId || '');
    // NEW: Instantiate version update hook
    const updateVersionDetailsMutation = useUpdateVersionDetails(currentVersionId || '', selectedDesignIdForModal || ''); 

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

    // --- NEW: Handlers for Editing VERSION Details ---
    const handleEditVersionDetailsClick = () => {
        if (!currentVersion) return;
        setEditingVersionStage(currentVersion.stage);
        setEditingVersionStatus(currentVersion.status);
        setIsEditingVersionDetails(true);
    };

    const handleCancelEditVersionDetails = () => {
        setIsEditingVersionDetails(false);
        setEditingVersionStage(null); // Clear temporary state
        setEditingVersionStatus(null);
    };

    const handleSaveVersionDetails = () => {
        if (!currentVersionId || !editingVersionStage || !editingVersionStatus) {
            toast.error("Missing information to save version details.");
            return;
        }
        updateVersionDetailsMutation.mutate(
            { stage: editingVersionStage, status: editingVersionStatus },
            {
                onSuccess: (data) => {
                    setIsEditingVersionDetails(false); // Exit edit mode on success
                    // Invalidate the design grid query to reflect changes
                    queryClient.invalidateQueries({ queryKey: ['designs', selectedProjectId] }); 
                    // Toast and designDetails invalidation are handled by the hook
                },
                onError: () => {
                     // Toast handled by hook, maybe add specific UI feedback?
                },
            }
        );
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

                        <div className="flex justify-between items-center mb-4">
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
                        
                        {/* Design Grid Area */}
                        <div className="flex justify-between items-center mb-4 mt-6"> {/* Added margin-top */} 
                             <h2 className="text-2xl font-semibold">Designs</h2>
                             <Dialog> 
                                 {/* ... dialog trigger and content ... */}
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
                       <DialogOverlay className="bg-black/50" /> 
                       <DialogContent className="p-0 h-[90vh] flex flex-col w-full max-w-full sm:max-w-[95vw] xl:max-w-screen-xl"> {/* Wider max-width */} 
                           <DialogHeader className="p-4 border-b shrink-0 flex flex-row justify-between items-center"> {/* Keep Header Flex */} 
                               {/* Wrap Title ONLY */} 
                               <div className="flex items-center gap-4"> 
                                    <DialogTitle>{designDetailsData?.name || 'Loading Design...'}</DialogTitle>
                               </div>
                               {/* Close button will implicitly be pushed right */} 
                           </DialogHeader>
                           
                           {/* Main Content Area - Grid for Image/Nav(Left) and Comments(Right) */} 
                           <div className="grid grid-cols-[3fr_1fr] flex-grow overflow-hidden"> {/* Adjust column ratio as needed */} 

                               {/* Left Side (Nav + Image) */} 
                               <div className="grid grid-rows-[auto_1fr] overflow-hidden">
                                   {/* Version/Variation Navigation */} 
                                   <nav className="p-4 border-b overflow-y-auto max-h-[35vh]"> {/* Adjusted max-height */} 
                                       {/* --- Version Section --- */} 
                                       <div className="mb-4 pb-4 border-b"> {/* Added border */} 
                                           <div className="flex justify-between items-center mb-2"> {/* Title + Edit Area */} 
                                               <h4 className="text-sm font-medium">Version</h4>
                                               {/* Version Edit Controls - Show only if a version is selected */}
                                               {currentVersion && (
                                                    isEditingVersionDetails ? (
                                                         <div className="flex items-center gap-1"> {/* Edit Mode */} 
                                                             {/* Stage Select */}
                                                             <Select 
                                                                  value={editingVersionStage || ''} 
                                                                  onValueChange={(value) => setEditingVersionStage(value as DesignStage)}
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
                                                             {/* Status Select */}
                                                             <Select 
                                                                 value={editingVersionStatus || ''} 
                                                                 onValueChange={(value) => setEditingVersionStatus(value as VersionRoundStatus)}
                                                             >
                                                                 <SelectTrigger className="w-[140px] h-7 text-xs">
                                                                     <SelectValue placeholder="Status..." />
                                                                 </SelectTrigger>
                                                                 <SelectContent>
                                                                     {Object.values(VersionRoundStatus).map((status) => (
                                                                         <SelectItem key={status} value={status} className="text-xs">
                                                                             {status}
                                                                         </SelectItem>
                                                                     ))}
                                                                 </SelectContent>
                                                             </Select>
                                                             {/* Save/Cancel Buttons */}
                                                             <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSaveVersionDetails} disabled={updateVersionDetailsMutation.isPending}>
                                                                 {updateVersionDetailsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin"/> : <Check className="h-4 w-4 text-green-600" />}
                                                             </Button>
                                                             <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleCancelEditVersionDetails} disabled={updateVersionDetailsMutation.isPending}>
                                                                 <X className="h-4 w-4 text-red-600" />
                                                             </Button>
                                                         </div>
                                                    ) : (
                                                         <div className="flex items-center gap-1.5"> {/* Display Mode */} 
                                                            <Badge variant="secondary" className="text-xs capitalize">{currentVersion.stage || 'N/A'}</Badge>
                                                            <Badge variant="outline" className="text-xs">{currentVersion.status || 'N/A'}</Badge>
                                                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleEditVersionDetailsClick}>
                                                                <Pencil className="h-3 w-3" />
                                                            </Button>
                                                         </div>
                                                    )
                                                )}
                                           </div>
                                           {/* Version Buttons */} 
                                           <div className="flex flex-wrap gap-2">
                                                {designDetailsData?.versions.map((version) => (
                                                    <Button 
                                                        key={version.id} 
                                                        variant={currentVersionId === version.id ? 'default' : 'outline'} 
                                                        size="sm"
                                                        onClick={() => handleVersionChange(version.id)}
                                                        className="min-w-[4rem]"
                                                    >
                                                        V{version.version_number}
                                                    </Button>
                                                ))}
                                                {(!designDetailsData?.versions || designDetailsData.versions.length === 0) && (
                                                    <p className="text-xs text-muted-foreground italic">No versions found.</p>
                                                )}
                                           </div>
                                       </div>

                                       {/* --- Variation Section --- */} 
                                       <div className="mt-3"> {/* Add some margin-top */} 
                                           <h4 className="text-sm font-medium mb-2">Variations for V{currentVersion?.version_number}</h4> 
                                           <div className="flex flex-wrap gap-2">
                                               {currentVersion?.variations.map((variation, index) => {
                                                   const displayLetter = String.fromCharCode(65 + index); // Calculate A, B, C...
                                                   return (
                                                       <Button 
                                                           key={variation.id} 
                                                           variant={currentVariationId === variation.id ? 'default' : 'outline'}
                                                           size="sm"
                                                           onClick={() => handleVariationChange(variation.id)}
                                                           className="min-w-[3rem]"
                                                       >
                                                           {displayLetter}
                                                       </Button>
                                                   );
                                               })}
                                               {(!currentVersion?.variations || currentVersion.variations.length === 0) && (
                                                   <p className="text-xs text-muted-foreground italic">No variations for this version.</p>
                                               )}
                                           </div>
                                       </div>
                                       {/* --- End of Variation Section --- */} 
                                   </nav>

                                   {/* Image Viewer */} 
                                   <div className="p-4 flex items-center justify-center overflow-hidden">
                                        {isLoadingDesignDetails ? (
                                            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                                        ) : errorDesignDetails ? (
                                            <div className="text-red-600">Error loading image area.</div>
                                        ) : designDetailsData ? (
                                            <ModalImageViewer filePath={selectedVariation?.file_path} />
                                        ) : (
                                            <div>No image data.</div>
                                        )}
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
                                           <div className="p-4 border-b shrink-0"> {/* Keep details fixed */} 
                                                <h4 className="text-base font-semibold mb-2">Details</h4>
                                                <p className="text-xs text-muted-foreground mb-1">Status:</p>
                                                <Badge variant={selectedVariation?.status === 'Rejected' ? 'destructive' : 'secondary'} className="mb-4">
                                                     {selectedVariation?.status || 'N/A'}
                                                </Badge>
                                                {/* Add other details here if needed */} 
                                           </div>

                                           {/* Comments Panel Placeholder */} 
                                           <div className="p-4 flex-grow bg-gray-50"> {/* Comments take remaining space */} 
                                               <h4 className="text-base font-semibold mb-2">Comments</h4>
                                               <p className="text-muted-foreground text-sm">Comments Panel Placeholder</p>
                                               {/* TODO: Add Comments Implementation */}
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