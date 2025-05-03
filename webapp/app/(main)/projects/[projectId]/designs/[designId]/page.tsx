'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from "@/components/ui/badge";
import { Loader2, Pencil, Check, X, PlusCircle } from 'lucide-react'; // Removed unused icons: ImageOff, Eye, EyeOff, Trash2, Upload
import Link from 'next/link';
import Breadcrumbs, { BreadcrumbItem } from '@/components/ui/breadcrumbs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog as VersionDialog,
  DialogContent as VersionDialogContent,
  DialogDescription as VersionDialogDescription,
  DialogFooter as VersionDialogFooter,
  DialogHeader as VersionDialogHeader,
  DialogTitle as VersionDialogTitle,
  DialogTrigger as VersionDialogTrigger,
  DialogClose as VersionDialogClose,
} from '@/components/ui/dialog';
import { Label as VersionLabel } from "@/components/ui/label";
import { Controller, useForm as useVersionForm } from 'react-hook-form';
import { zodResolver as versionZodResolver } from '@hookform/resolvers/zod';
import * as versionZod from 'zod';

// --- Import types from central location --- 
import {
    Project,
    Design,
    Version,
    DesignStage,
    DesignWithVersions,
    Variation,
    VariationFeedbackStatus,
    NewVersionData,
    VersionRoundStatus,
} from '@/types/models';

// --- Zod Schema for New Version Form --- 
const versionSchema = versionZod.object({
  notes: versionZod.string().optional(),
  // Use the DesignStage enum for nativeEnum validation
  stage: versionZod.nativeEnum(DesignStage, { 
      required_error: "Stage is required",
      invalid_type_error: "Invalid stage selected", 
  }),
});

// Fetch function for a single project (needed for breadcrumbs)
const fetchProject = async (supabase: any, projectId: string): Promise<Project | null> => {
    if (!projectId) return null;
    const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .eq('id', projectId)
        .single();
    if (error) {
        console.error('Error fetching project for breadcrumbs:', error);
        if (error.code === 'PGRST116') return null;
        throw new Error(error.message);
    }
    return data as Project | null;
};

// Fetch function for versions of a design
const fetchVersions = async (supabase: any, designId: string): Promise<Version[]> => {
    if (!designId) return [];
    const { data, error } = await supabase
        .from('versions') 
        .select(`
            id,
            version_number,
            status,
            stage,
            created_at 
        `)
        .eq('design_id', designId)
        .order('version_number', { ascending: true });

    if (error) {
        console.error('Full Supabase Versions Fetch Error:', error);
        throw new Error(`Failed to fetch versions: ${error?.message || JSON.stringify(error)}`);
    }
    return (data as Version[]) || [];
};

// --- Update Design Details Hook ---
const useUpdateDesignDetails = (designId: string, projectId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ name, description }: { name: string, description: string | null }) => { 
            if (!supabase) throw new Error("Supabase client not available");
            if (!designId) throw new Error("Design ID is required");
            if (!name?.trim()) throw new Error("Design name cannot be empty"); 

            const updateData: { name: string, description?: string | null, updated_at: string } = {
                name: name.trim(),
                updated_at: new Date().toISOString()
            };
            // Only include description if it's provided (could be null or string)
            if (description !== undefined) { 
                updateData.description = description;
            }

            const { data, error } = await supabase
                .from('designs')
                .update(updateData)
                .eq('id', designId)
                .select()
                .single();

            if (error) {
                console.error('Full Supabase Update Details Error:', error);
                throw new Error(`Failed to update details: ${error?.message || JSON.stringify(error)}`);
            }
            return data;
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// --- Add Version Hook ---
const useAddVersion = (designId: string) => {
    const { supabase } = useAuth();
    const queryClient = useQueryClient();

    return useMutation<
        Version,
        Error,
        NewVersionData
    >({
        mutationFn: async (newVersionData: NewVersionData) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!designId) throw new Error("Design ID is required");

            // 1. Get latest version number
            const { data: latestVersion, error: latestVersionError } = await supabase
                .from('versions')
                .select('version_number')
                .eq('design_id', designId)
                .order('version_number', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (latestVersionError) {
                console.error('Error fetching latest version number:', latestVersionError);
                throw new Error('Could not determine next version number.');
            }
            const nextVersionNumber = latestVersion ? latestVersion.version_number + 1 : 1;

            // 2. Prepare insert data
            const insertData: NewVersionData = {
                design_id: designId,
                version_number: nextVersionNumber,
                notes: newVersionData.notes || null,
                stage: newVersionData.stage,
                status: VersionRoundStatus.WorkInProgress,
            };

            // 3. Insert new version
            const { data, error } = await supabase
                .from('versions')
                .insert(insertData)
                .select()
                .single();

            if (error) {
                console.error('Error adding version:', error);
                throw new Error(`Failed to add version: ${error.message || JSON.stringify(error)}`);
            }
            return data;
        },
        onSuccess: (data) => {
            toast.success(`Version V${data.version_number} (${data.stage}) added successfully!`);
            queryClient.invalidateQueries({ queryKey: ['versions', designId] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};

// Fetch function for a single design and its versions
const fetchDesignWithVersions = async (supabase: any, designId: string): Promise<DesignWithVersions | null> => {
    if (!supabase || !designId) return null;

    // 1. Fetch the design by designId
    const { data: design, error: designError } = await supabase
        .from('designs')
        .select(`
            id,
            project_id,
            name,
            description,
            status,
            created_at,
            updated_at,
            created_by
        `)
        .eq('id', designId)
        .maybeSingle(); // Use maybeSingle to handle not found gracefully

    if (designError) {
        console.error('Error fetching design:', designError);
        throw new Error(`Failed to fetch design: ${designError.message}`);
    }

    // If design not found, return null
    if (!design) {
        console.log(`Design with ID ${designId} not found.`);
        return null;
    }

    // 2. Fetch all versions where version.design_id === designId
    const { data: versions, error: versionsError } = await supabase
        .from('versions')
        .select(`
            id,
            design_id,
            version_number,
            status, 
            created_at,
            updated_at
        `)
        .eq('design_id', designId)
        .order('version_number', { ascending: true });

    if (versionsError) {
        console.error('Error fetching versions for design:', versionsError);
        // Don't necessarily throw; maybe return design with empty versions?
        // For now, let's throw to indicate a problem.
        throw new Error(`Failed to fetch versions: ${versionsError.message}`);
    }

    // 3. Combine results
    const result: DesignWithVersions = {
        ...design,
        versions: (versions as Version[]) || [], // Ensure versions is an array
    };

    return result;
};

const useDesignDetails = (designId: string) => {
  const supabase = useAuth().supabase;
  return useQuery<
    (Design & { versions: (Version & { variations: Variation[], project: Project })[] }) | null,
    Error // Specify Error type
  >({
    queryKey: ['designDetails', designId],
    queryFn: async () => {
      if (!supabase || !designId) return null;
      const { data, error } = await supabase
        .from('designs')
        .select(`
          *,
          versions ( *,
            variations ( * ),
            project ( name ) 
          )
        `)
        .eq('id', designId)
        .order('version_number', { referencedTable: 'versions', ascending: false })
        .single();

      if (error) {
        console.error('Error fetching design details:', error);
        throw new Error(error.message);
      }
      // Type assertion needed as Supabase types might not be perfect
      return data as (Design & { versions: (Version & { variations: Variation[], project: Project })[] }) | null;
    },
    enabled: !!designId,
  });
};

const useVersionsForDesign = (designId: string) => {
  const supabase = useAuth().supabase;
  return useQuery<Version[]>({
    queryKey: ['versions', designId],
    queryFn: () => fetchVersions(supabase, designId),
    enabled: !!supabase && !!designId,
  });
};

export default function DesignDetailPage() {
    const { supabase } = useAuth();
    const params = useParams();
    const projectId = params.projectId as string;
    const designId = params.designId as string;
    const queryClient = useQueryClient();

    // Edit State
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState('');
    const [editedDescription, setEditedDescription] = useState<string | null>('');
    const [isAddVersionDialogOpen, setIsAddVersionDialogOpen] = useState(false);

    // Fetch Project details (for breadcrumbs)
    const { data: project, isLoading: isLoadingProject } = useQuery({
        queryKey: ['project', projectId],
        queryFn: () => fetchProject(supabase, projectId),
        enabled: !!supabase && !!projectId,
        staleTime: Infinity, // Project name unlikely to change often while viewing design
    });

    // Fetch Design details with its versions
    const { data: designData, isLoading: isLoadingDesign, error: designError } = useQuery<DesignWithVersions | null>({
        queryKey: ['design', designId, 'versions'],
        queryFn: () => fetchDesignWithVersions(supabase, designId),
        enabled: !!supabase && !!designId,
    });

    // Fetch Versions for this design
    const { data: versions, isLoading: isLoadingVersions, error: versionsError } = useQuery<Version[]>({
        queryKey: ['versions', designId],
        queryFn: () => fetchVersions(supabase, designId),
        enabled: !!supabase && !!designId,
    });

    // Effect to initialize edit state when design data loads
    useEffect(() => {
        if (designData && !isEditing) {
            setEditedName(designData.name);
            setEditedDescription(designData.description || '');
        }
    }, [designData, isEditing]);

    // Mutations
    const updateDetailsMutation = useUpdateDesignDetails(designId, projectId);
    const addVersionMutation = useAddVersion(designId);

    // --- Form Hooks ---
    const {
        register: registerVersion,
        handleSubmit: handleSubmitVersion,
        control: controlVersion,
        reset: resetVersionForm,
        formState: { errors: versionFormErrors },
    } = useVersionForm<versionZod.infer<typeof versionSchema>>({
        resolver: versionZodResolver(versionSchema),
        defaultValues: {
            notes: '',
            stage: undefined,
        },
    });

    // --- Edit Handlers ---
    const handleEditClick = () => {
        if (!designData) return;
        setEditedName(designData.name);
        setEditedDescription(designData.description || '');
        setIsEditing(true);
    };

    const handleCancelClick = () => {
        setIsEditing(false);
        if (designData) {
            setEditedName(designData.name);
            setEditedDescription(designData.description || '');
        }
    };

    const handleSaveClick = () => {
        if (!designData) return;
        const trimmedName = editedName.trim();
        const currentDescription = designData.description || '';
        const newDescription = editedDescription || '';

        if (!trimmedName) {
            toast.error("Design name cannot be empty.");
            return;
        }
        
        const nameChanged = trimmedName !== designData.name;
        const descriptionChanged = newDescription !== currentDescription;

        if (!nameChanged && !descriptionChanged) {
            setIsEditing(false);
            return;
        }

        updateDetailsMutation.mutate({ name: trimmedName, description: editedDescription }, {
            onSuccess: (data) => {
                toast.success(`Design "${data.name}" details updated!`);
                queryClient.invalidateQueries({ queryKey: ['design', projectId, designId] });
                setIsEditing(false); 
            },
        });
    };

    // Add Version Submit Handler
    const handleAddVersionSubmit = (values: versionZod.infer<typeof versionSchema>) => {
        // Compute next version number
        const nextVersionNumber = versions && versions.length > 0 ? (versions[versions.length - 1].version_number + 1) : 1;
        addVersionMutation.mutate({
            design_id: designId,
            version_number: nextVersionNumber,
            notes: values.notes || null,
            stage: values.stage,
            status: VersionRoundStatus.WorkInProgress,
        }, {
            onSuccess: (data) => {
                toast.success(`Version V${data.version_number} (${data.stage}) added successfully!`);
                queryClient.invalidateQueries({ queryKey: ['versions', designId] }); 
                resetVersionForm();
                setIsAddVersionDialogOpen(false); 
            },
        });
    };

    // Combined Loading State
    if (isLoadingProject || isLoadingDesign || isLoadingVersions) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /> Loading Design Details...</div>;
    }

    // Error State
    if (designError) {
        return (
            <div className="container mx-auto p-4">
                <h1 className="text-2xl font-bold text-red-600">Error Loading Design</h1>
                <p>{(designError as Error)?.message || 'An unknown error occurred.'}</p>
                <Link href={`/projects/${projectId}`} className="text-blue-600 hover:underline mt-4 inline-block">
                    Return to Project
                </Link>
            </div>
        );
    }

    if (!designData) {
        return (
            <div className="container mx-auto p-4">
                <h1 className="text-2xl font-bold">Design Not Found</h1>
                <p>The requested design could not be found.</p>
                 <Link href={`/projects/${projectId}`} className="text-blue-600 hover:underline mt-4 inline-block">
                    Return to Project
                </Link>
            </div>
        );
    }

    // Define breadcrumb items
    const breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Dashboard', href: '/dashboard' },
        { label: project?.name ?? 'Project', href: `/projects/${projectId}` },
        { label: designData.name } // Current design page
    ];

    return (
        <div className="container mx-auto p-4 space-y-6">
            <Breadcrumbs items={breadcrumbItems} />

            <Card>
                <CardHeader>
                    <div className="flex justify-between items-start gap-4">
                        {/* Title or Input */} 
                        <div className="flex-1">
                           {isEditing ? (
                                <Input 
                                    value={editedName}
                                    onChange={(e) => setEditedName(e.target.value)}
                                    className="text-2xl font-bold p-1 h-auto" // Basic styling to match title
                                    // Disable input while name update is pending
                                    disabled={updateDetailsMutation.isPending} 
                                />
                           ) : (
                               <CardTitle className="text-2xl mb-1">{designData.name}</CardTitle>
                           )}
                            <CardDescription>
                                Part of project: <Link href={`/projects/${projectId}`} className="hover:underline">{project?.name ?? '...'}</Link>
                            </CardDescription>
                        </div>
                        
                        {/* Controls: Edit/Save/Cancel and Stage Select */} 
                        <div className="flex items-center gap-2">
                            {/* Edit/Save/Cancel Buttons */} 
                            {!isEditing ? (
                                <Button variant="ghost" size="icon" onClick={handleEditClick} aria-label="Edit design details">
                                    <Pencil className="h-4 w-4" />
                                </Button>
                            ) : (
                                <>
                                    <Button variant="ghost" size="icon" onClick={handleSaveClick} aria-label="Save changes" disabled={updateDetailsMutation.isPending}> 
                                        {/* Show loader on save button when pending */} 
                                        {updateDetailsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-green-600" />}
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={handleCancelClick} aria-label="Cancel editing" disabled={updateDetailsMutation.isPending}>
                                        <X className="h-4 w-4 text-red-600" />
                                    </Button>
                                </> 
                            )}

                           {/* Display Overall Design Status */} 
                           {!isEditing && (
                               <Badge variant={designData.status === 'Completed' || designData.status === 'Archived' ? 'default' : 'secondary'}>
                                   {designData.status}
                               </Badge>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {/* Display/Edit Description */} 
                    {isEditing ? (
                        <Textarea
                            value={editedDescription || ''}
                            onChange={(e) => setEditedDescription(e.target.value)}
                            placeholder="Enter design description..."
                            className="mb-4"
                            rows={4}
                            disabled={updateDetailsMutation.isPending}
                        />
                    ) : designData.description ? (
                        <p className="mb-4 whitespace-pre-wrap">{designData.description}</p>
                    ) : (
                        <p className="italic text-muted-foreground mb-4">No description provided for this design.</p>
                    )}
                    
                    <p className="text-sm text-muted-foreground mt-4">
                        Created: {new Date(designData.created_at).toLocaleDateString()}
                    </p>
                </CardContent>
            </Card>

            {/* --- Versions Section --- */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Versions</CardTitle>
                        <CardDescription>Versions associated with this design.</CardDescription>
                    </div>
                    {/* Add Version Button & Dialog Trigger */}
                    <VersionDialog open={isAddVersionDialogOpen} onOpenChange={setIsAddVersionDialogOpen}>
                        <VersionDialogTrigger asChild>
                            <Button size="sm" disabled={addVersionMutation.isPending}> 
                                <PlusCircle className="mr-2 h-4 w-4" /> Add Version
                            </Button>
                        </VersionDialogTrigger>
                        {/* --- Add Version Dialog Content --- */}
                        <VersionDialogContent className="sm:max-w-[425px]">
                            <VersionDialogHeader>
                                <VersionDialogTitle>Add New Version V{versions ? (versions[versions.length - 1]?.version_number ?? 0) + 1 : 1}</VersionDialogTitle>
                                <VersionDialogDescription>
Select the stage for this new version and add optional notes. Status will default to &apos;Work in Progress&apos;.
                                </VersionDialogDescription>
                            </VersionDialogHeader>
                            <form onSubmit={handleSubmitVersion(handleAddVersionSubmit)} className="space-y-4">
                                {/* Stage Select (Required) */} 
                                <div className="space-y-1">
                                     <VersionLabel htmlFor="versionStage">Stage *</VersionLabel>
                                     {/* Use Controller for Shadcn Select with react-hook-form */}
                                     <Controller
                                        name="stage"
                                        control={controlVersion}
                                        render={({ field }) => (
                                            <Select 
                                                onValueChange={field.onChange}
                                                defaultValue={field.value} // Use defaultValue for initial render
                                                disabled={addVersionMutation.isPending}
                                            >
                                                <SelectTrigger id="versionStage">
                                                    <SelectValue placeholder="Select stage..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {/* Use Object.values for enums */} 
                                                    {Object.values(DesignStage).map(stage => (
                                                        <SelectItem key={stage} value={stage}>{stage}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                     {versionFormErrors.stage && <p className="text-xs text-red-600">{versionFormErrors.stage.message}</p>}
                                 </div>

                                {/* Notes Textarea (Optional) */} 
                                <div className="space-y-1">
                                    <VersionLabel htmlFor="versionNotes">Notes</VersionLabel>
                                    <Textarea 
                                        id="versionNotes" 
                                        rows={4}
                                        {...registerVersion("notes")} 
                                        disabled={addVersionMutation.isPending}
                                        placeholder="Add any relevant notes for this version..."
                                    />
                                    {/* Optional: Add error display for notes if validation added */}
                                </div>
                                <VersionDialogFooter>
                                    <VersionDialogClose asChild>
                                        <Button type="button" variant="outline" disabled={addVersionMutation.isPending}>Cancel</Button>
                                    </VersionDialogClose>
                                    <Button type="submit" disabled={addVersionMutation.isPending}>
                                        {addVersionMutation.isPending 
                                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding...</> 
                                            : `Add Version V${versions ? (versions[versions.length - 1]?.version_number ?? 0) + 1 : 1}`}
                                    </Button>
                                </VersionDialogFooter>
                            </form>
                        </VersionDialogContent>
                    </VersionDialog>
                </CardHeader>
                <CardContent>
                   {isLoadingDesign ? (
                     <div className="flex justify-center items-center p-4"><Loader2 className="h-6 w-6 animate-spin" /> Loading Versions...</div>
                   ) : designData.versions && designData.versions.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Version</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Created</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {designData.versions.map((version) => (
                                    <TableRow key={version.id}>
                                        <TableCell className="font-medium">
                                            {/* Link to version detail page */}
                                            <Link href={`/projects/${projectId}/designs/${designId}/versions/${version.id}`} className="hover:underline">
                                                V{version.version_number}
                                            </Link>
                                        </TableCell>
                                        <TableCell>
                                            {/* Use Badge component with appropriate variant based on status */}
                                            <Badge variant={
                                                version.status === 'Round Complete' ? 'default' 
                                                : version.status === 'Ready for Review' ? 'outline'
                                                : 'secondary' // Default for WIP, Feedback Received
                                            }>
                                                {version.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {new Date(version.created_at).toLocaleDateString()}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <p className="italic text-muted-foreground text-center p-4">No versions found for this design yet.</p>
                    )}
                </CardContent>
            </Card>

            {/* TODO: Add Variations section? */} 

        </div>
    );
} 