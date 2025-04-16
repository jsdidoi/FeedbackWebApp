'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, Pencil, Check, X } from 'lucide-react';
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
} from '@/components/ui/dialog';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';

// Import the Project type - ideally share this from a types file later
type ProjectStatus = 'Pending' | 'In Progress' | 'In Review' | 'Approved' | 'Needs Changes' | 'Completed' | 'Archived';
type Project = {
    id: string;
    client_id: string | null;
    name: string;
    description: string | null;
    status: ProjectStatus;
    created_at: string;
    updated_at: string;
    clients: { id: string; name: string } | null; // Expect single object
};

// Define Design type - Updated
const designOverallStatuses = ['Active', 'On Hold', 'Completed', 'Archived'] as const;
// Define enum type if not globally available
type DesignOverallStatus = typeof designOverallStatuses[number]; 

type Design = {
    id: string;
    project_id: string;
    name: string;
    // stage: DesignStage; // Removed stage
    status: DesignOverallStatus; // Added overall status
    created_at: string;
    updated_at: string;
    created_by: string;
};

// Type for inserting a new design
type NewDesign = {
    project_id: string;
    name: string;
    // stage defaults to 'Sketch'
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

// Fetch function for designs of a project - Restored Correctly
const fetchDesigns = async (supabase: any, projectId: string): Promise<Design[]> => {
    if (!projectId) return [];

    const { data, error } = await supabase
        .from('designs')
        .select(`
            id,
            name,
            status,
            created_at 
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

    if (error) {
        // Keep detailed logging
        console.error('RAW Supabase fetchDesigns ERROR object:', JSON.stringify(error, null, 2)); 
        console.error('Error fetching designs:', error); 
        throw new Error(`Failed to fetch designs: ${error?.message || JSON.stringify(error)}`);
    }
    return (data as Design[]) || [];
};

// --- Add Design Hook ---
const useAddDesign = (projectId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (newDesignData: Pick<NewDesign, 'name'>) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!projectId) throw new Error("Project ID is required");

            const insertData: NewDesign = {
                project_id: projectId,
                name: newDesignData.name,
                // stage defaults in DB
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
            // Invalidate the designs query for this project to refetch
            queryClient.invalidateQueries({ queryKey: ['designs', projectId] }); 
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

export default function ProjectDetailPage() {
    const { supabase } = useAuth();
    const params = useParams();
    const projectId = params.projectId as string;
    const queryClient = useQueryClient(); // Get queryClient instance

    // State for Add Design Dialog
    const [isAddDesignDialogOpen, setIsAddDesignDialogOpen] = useState(false);

    // Edit State
    const [isEditingProject, setIsEditingProject] = useState(false);
    const [editedProjectName, setEditedProjectName] = useState('');
    const [editedProjectDescription, setEditedProjectDescription] = useState<string | null>('');

    // Form hook for Add Design
    const {
        register: registerDesign,
        handleSubmit: handleSubmitDesign,
        reset: resetDesignForm,
        formState: { errors: designFormErrors },
    } = useForm<z.infer<typeof designSchema>>({
        resolver: zodResolver(designSchema),
        defaultValues: {
            name: '',
        },
    });

    // Fetch Project details
    const { data: project, isLoading: isLoadingProject, error: projectError, isError: isProjectError } = useQuery<Project | null>({
        queryKey: ['project', projectId],
        queryFn: () => fetchProject(supabase, projectId),
        enabled: !!supabase && !!projectId,
    });

    // Fetch Designs for this project
    const { data: designs, isLoading: isLoadingDesigns, error: designsError } = useQuery<Design[]>({
        queryKey: ['designs', projectId], 
        queryFn: () => fetchDesigns(supabase, projectId),
        enabled: !!supabase && !!projectId, 
    });
    
    // Add Design Mutation
    const addDesignMutation = useAddDesign(projectId);

    // Effect to initialize project edit state
    useEffect(() => {
        if (project && !isEditingProject) {
            setEditedProjectName(project.name);
            setEditedProjectDescription(project.description || '');
        }
    }, [project, isEditingProject]);

    // Mutations
    const updateProjectDetailsMutation = useUpdateProjectDetails(projectId);

    // Handler for Add Design Form Submit
    const handleAddDesignSubmit = (values: z.infer<typeof designSchema>) => {
        addDesignMutation.mutate(values, {
            onSuccess: (data) => { // onSuccess is passed here for dialog closing
                toast.success(`Design "${data.name}" added successfully!`);
                queryClient.invalidateQueries({ queryKey: ['designs', projectId] }); 
                resetDesignForm();
                setIsAddDesignDialogOpen(false);
            },
            onError: (error) => { // Still have global onError if needed
                 toast.error(error.message);
            }
        });
    };

    // --- Project Edit Handlers ---
    const handleProjectEditClick = () => {
        if (!project) return;
        setEditedProjectName(project.name);
        setEditedProjectDescription(project.description || '');
        setIsEditingProject(true);
    };

    const handleProjectCancelClick = () => {
        setIsEditingProject(false);
        if (project) {
            setEditedProjectName(project.name);
            setEditedProjectDescription(project.description || '');
        }
    };

    const handleProjectSaveClick = () => {
        if (!project) return;
        const trimmedName = editedProjectName.trim();
        const currentDescription = project.description || '';
        const newDescription = editedProjectDescription || '';

        if (!trimmedName) {
            toast.error("Project name cannot be empty.");
            return;
        }

        const nameChanged = trimmedName !== project.name;
        const descriptionChanged = newDescription !== currentDescription;

        if (!nameChanged && !descriptionChanged) {
            setIsEditingProject(false);
            return;
        }

        updateProjectDetailsMutation.mutate({ name: trimmedName, description: editedProjectDescription }, {
            onSuccess: (data) => {
                toast.success(`Project "${data.name}" details updated!`);
                queryClient.invalidateQueries({ queryKey: ['project', projectId] });
                 // Also invalidate dashboard list if needed
                 // queryClient.invalidateQueries({ queryKey: ['projects'] });
                setIsEditingProject(false);
            },
        });
    };

    if (isLoadingProject) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /> Loading Project...</div>;
    }

    if (isProjectError || !project) {
        return (
            <div className="container mx-auto p-4">
                <h1 className="text-2xl font-bold text-red-600">Error</h1>
                <p>{projectError ? projectError.message : 'Project not found.'}</p>
                <Link href="/dashboard" className="text-blue-600 hover:underline mt-4 inline-block">
                    Return to Dashboard
                </Link>
            </div>
        );
    }

    // Define breadcrumb items once project data is available
    const breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Dashboard', href: '/dashboard' },
        { label: project.name } // Current project page
    ];

    return (
        <div className="container mx-auto p-4 space-y-6">
            {/* Add Breadcrumbs at the top */}
            <Breadcrumbs items={breadcrumbItems} /> 

            <Card>
                <CardHeader>
                    <div className="flex justify-between items-start gap-4">
                        {/* Project Title/Input */} 
                        <div className="flex-1">
                             {isEditingProject ? (
                                <Input 
                                    value={editedProjectName}
                                    onChange={(e) => setEditedProjectName(e.target.value)}
                                    className="text-2xl font-bold p-1 h-auto mb-1"
                                    disabled={updateProjectDetailsMutation.isPending}
                                />
                             ) : (
                                <CardTitle className="text-2xl mb-1">{project.name}</CardTitle>
                             )}
                            <CardDescription>
                                Client: {project.clients?.name ?? <span className="italic text-muted-foreground">No Client Assigned</span>}
                            </CardDescription>
                        </div>

                        {/* Project Controls: Edit/Save/Cancel & Status Badge */}
                        <div className="flex items-center gap-2">
                            {!isEditingProject ? (
                                <Button variant="ghost" size="icon" onClick={handleProjectEditClick} aria-label="Edit project details">
                                    <Pencil className="h-4 w-4" />
                                </Button>
                            ) : (
                                <>
                                    <Button variant="ghost" size="icon" onClick={handleProjectSaveClick} aria-label="Save project changes" disabled={updateProjectDetailsMutation.isPending}>
                                        {updateProjectDetailsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-green-600" />}
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={handleProjectCancelClick} aria-label="Cancel project editing" disabled={updateProjectDetailsMutation.isPending}>
                                        <X className="h-4 w-4 text-red-600" />
                                    </Button>
                                </> 
                            )}
                            {/* Keep status badge visible */} 
                            {!isEditingProject && (
                                <Badge variant={project.status === 'Completed' || project.status === 'Approved' ? 'default' : 'secondary'}>
                                    {project.status}
                                </Badge>
                            )} 
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {/* Project Description */} 
                     {isEditingProject ? (
                        <Textarea
                            value={editedProjectDescription || ''}
                            onChange={(e) => setEditedProjectDescription(e.target.value)}
                            placeholder="Enter project description..."
                            className="mb-4"
                            rows={3}
                            disabled={updateProjectDetailsMutation.isPending}
                        />
                     ) : project.description ? (
                        <p className="mb-4 whitespace-pre-wrap">{project.description}</p>
                    ) : (
                        <p className="italic text-muted-foreground mb-4">No description provided.</p>
                    )}
                    <p className="text-sm text-muted-foreground mt-4">
                        Created: {new Date(project.created_at).toLocaleDateString()}
                    </p>
                </CardContent>
            </Card>

            {/* Designs Section - Updated Table */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Designs</CardTitle>
                        <CardDescription>Designs associated with this project.</CardDescription>
                    </div>
                    {/* Add Design Button triggers Dialog */}
                    <Dialog open={isAddDesignDialogOpen} onOpenChange={setIsAddDesignDialogOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm">
                                <PlusCircle className="mr-2 h-4 w-4" /> Add Design
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Add New Design</DialogTitle>
                                <DialogDescription>
Enter the name for the new design. The initial stage will be 'Sketch'.
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleSubmitDesign(handleAddDesignSubmit)} className="space-y-4">
                                <div className="space-y-1">
                                    <Label htmlFor="designName">Design Name *</Label>
                                    <Input 
                                        id="designName" 
                                        {...registerDesign("name")} 
                                        disabled={addDesignMutation.isPending}
                                    />
                                    {designFormErrors.name && <p className="text-xs text-red-600">{designFormErrors.name.message}</p>}
                                </div>
                                <DialogFooter>
                                    <DialogClose asChild>
                                        <Button type="button" variant="outline">Cancel</Button>
                                    </DialogClose>
                                    <Button type="submit" disabled={addDesignMutation.isPending}>
                                        {addDesignMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding...</> : "Add Design"}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                   {isLoadingDesigns ? (
                     <div className="flex justify-center items-center p-4"><Loader2 className="h-6 w-6 animate-spin" /> Loading Designs...</div>
                   ) : designsError ? (
                     <p className="text-red-600">Error loading designs: {designsError.message}</p>
                   ) : designs && designs.length > 0 ? (
                     <Table>
                        <TableHeader>
                            <TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Created</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                            {designs.map((design) => (<TableRow key={design.id}> 
                                    <TableCell className="font-medium">
                                        <Link href={`/projects/${projectId}/designs/${design.id}`} className="hover:underline">
                                            {design.name}
                                        </Link>
                                    </TableCell>
                                    <TableCell><Badge variant={design.status === 'Completed' || design.status === 'Archived' ? 'default' : 'secondary'}>{design.status}</Badge></TableCell> 
                                    <TableCell className="text-right">
                                        {/* Restoring date formatting */}
                                        {new Date(design.created_at).toLocaleDateString()}
                                    </TableCell>
                                </TableRow>))}
                        </TableBody>
                     </Table>
                   ) : (
                     <p className="italic text-muted-foreground text-center p-4">No designs have been added to this project yet.</p>
                   )}
                </CardContent>
            </Card>

        </div>
    );
} 