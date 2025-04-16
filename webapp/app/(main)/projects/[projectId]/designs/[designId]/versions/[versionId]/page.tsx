'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, Pencil } from 'lucide-react';
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
import { useForm as useVariationForm } from 'react-hook-form';
import { zodResolver as variationZodResolver } from '@hookform/resolvers/zod'; 
import * as variationZod from 'zod'; 
import { toast } from 'sonner';

// --- Type Definitions ---
// (Ideally share these globally)

// Project
type Project = {
    id: string;
    name: string;
};

// Design
const designOverallStatuses = ['Active', 'On Hold', 'Completed', 'Archived'] as const;
type DesignOverallStatus = typeof designOverallStatuses[number];
type Design = {
    id: string;
    name: string;
    status: DesignOverallStatus;
};

// Version
const designStages = ['sketch', 'refine', 'color', 'final'] as const; 
type DesignStage = typeof designStages[number];
const versionRoundStatuses = ['Work in Progress', 'Ready for Review', 'Feedback Received', 'Round Complete'] as const;
type VersionRoundStatus = typeof versionRoundStatuses[number]; 
type Version = {
    id: string;
    design_id: string;
    version_number: number; 
    notes: string | null;
    stage: DesignStage; 
    status: VersionRoundStatus; 
    created_at: string;
};

// Variation
const variationFeedbackStatuses = ['Pending Feedback', 'Needs Changes', 'Approved', 'Rejected'] as const;
type VariationFeedbackStatus = typeof variationFeedbackStatuses[number]; 
type Variation = {
    id: string;
    version_id: string;
    variation_letter: string; // e.g., 'A', 'B'
    notes: string | null;
    status: VariationFeedbackStatus;
    created_at: string;
};

// Type for inserting a new variation
type NewVariation = {
    version_id: string;
    variation_letter: string;
    notes: string | null;
    status: VariationFeedbackStatus;
};

// --- Zod Schema for New Variation Form ---
const variationSchema = variationZod.object({
  notes: variationZod.string().optional(), // Notes are optional
});

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
    const { data, error } = await supabase.from('designs').select('id, name, status').eq('id', designId).single();
    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching design:', error);
        throw new Error(error.message);
    }
    return data;
};

// Fetch Specific Version
const fetchVersion = async (supabase: any, versionId: string): Promise<Version | null> => {
    if (!versionId) return null;
    const { data, error } = await supabase
        .from('versions')
        .select('id, design_id, version_number, notes, stage, status, created_at')
        .eq('id', versionId)
        .single();
    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching version:', error);
        throw new Error(error.message);
    }
    return data;
};

// Fetch Variations for a Version
const fetchVariations = async (supabase: any, versionId: string): Promise<Variation[]> => {
    if (!versionId) return [];
    const { data, error } = await supabase
        .from('variations')
        .select('id, variation_letter, status, created_at') // Select needed fields
        .eq('version_id', versionId)
        .order('variation_letter', { ascending: true });
    if (error) {
        console.error('Error fetching variations:', error);
        throw new Error(error.message);
    }
    return data || [];
};

// --- Mutation Hooks ---

// --- Add Variation Hook ---
const useAddVariation = (versionId: string) => {
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
        mutationFn: async (newVariationData: { notes?: string | null }) => {
            if (!supabase) throw new Error("Supabase client not available");
            if (!versionId) throw new Error("Version ID is required");

            // 1. Get existing variation letters for this version
            const { data: existingVariations, error: fetchError } = await supabase
                .from('variations')
                .select('variation_letter')
                .eq('version_id', versionId);

            if (fetchError) {
                console.error('Error fetching existing variations:', fetchError);
                throw new Error('Could not determine next variation letter.');
            }

            const existingLetters = existingVariations?.map(v => v.variation_letter) || [];
            const nextLetter = getNextVariationLetter(existingLetters);
            
            // Add check here if you want to limit letters (e.g., error if nextLetter > 'Z')
            if (nextLetter > 'Z') {
                 throw new Error('Maximum number of variations reached.'); // Example limit
            }

            // 2. Prepare insert data
            const insertData: NewVariation = {
                version_id: versionId,
                variation_letter: nextLetter,
                notes: newVariationData.notes || null,
                status: 'Pending Feedback', // Default status
            };

            // 3. Insert new variation
            const { data, error: insertError } = await supabase
                .from('variations')
                .insert(insertData)
                .select()
                .single();

            if (insertError) {
                console.error('Error adding variation:', insertError);
                throw new Error(`Failed to add variation: ${insertError.message || JSON.stringify(insertError)}`);
            }
            return data;
        },
        onSuccess: (data) => {
            toast.success(`Variation ${data.variation_letter} added successfully!`);
            queryClient.invalidateQueries({ queryKey: ['variations', versionId] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
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

    // --- Form Hooks ---
    const {
        register: registerVariation,
        handleSubmit: handleSubmitVariation,
        reset: resetVariationForm,
        formState: { errors: variationFormErrors },
    } = useVariationForm<variationZod.infer<typeof variationSchema>>({
        resolver: variationZodResolver(variationSchema),
        defaultValues: { notes: '' },
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

    const { data: version, isLoading: isLoadingVersion, error: versionError } = useQuery<Version | null>({
        queryKey: ['version', versionId],
        queryFn: () => fetchVersion(supabase, versionId),
        enabled: !!supabase && !!versionId,
    });

    const { data: variations, isLoading: isLoadingVariations, error: variationsError } = useQuery<Variation[]>({
        queryKey: ['variations', versionId],
        queryFn: () => fetchVariations(supabase, versionId),
        enabled: !!supabase && !!versionId,
    });

    // --- Mutations ---
    const addVariationMutation = useAddVariation(versionId);

    // --- Handlers ---
    const handleAddVariationSubmit = (values: variationZod.infer<typeof variationSchema>) => {
        addVariationMutation.mutate({ notes: values.notes }, {
            onSuccess: (data) => {
                toast.success(`Variation ${data.variation_letter} added successfully!`);
                queryClient.invalidateQueries({ queryKey: ['variations', versionId] });
                resetVariationForm();
                setIsAddVariationDialogOpen(false);
            },
        });
    };

    // Calculate next variation letter for display purposes
    const existingLetters = variations?.map(v => v.variation_letter) || [];
    const nextVariationLetterDisplay = getNextVariationLetterForDisplay(existingLetters);
    
    // --- Loading & Error States ---
    if (isLoadingProject || isLoadingDesign || isLoadingVersion) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /> Loading Version Details...</div>;
    }

    if (versionError || !version) {
        return (
            <div className="container mx-auto p-4">
                <h1 className="text-2xl font-bold text-red-600">Error</h1>
                <p>{versionError ? versionError.message : 'Version not found.'}</p>
                <Link href={`/projects/${projectId}/designs/${designId}`} className="text-blue-600 hover:underline mt-4 inline-block">
                    Return to Design
                </Link>
            </div>
        );
    }

    // --- Breadcrumbs --- 
    const breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Dashboard', href: '/dashboard' },
        { label: project?.name ?? 'Project', href: `/projects/${projectId}` },
        { label: design?.name ?? 'Design', href: `/projects/${projectId}/designs/${designId}` },
        { label: `V${version.version_number}` } // Current version page
    ];

    // --- Render --- 
    return (
        <div className="container mx-auto p-4 space-y-6">
            <Breadcrumbs items={breadcrumbItems} />

            {/* --- Version Details Card --- */}
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-start gap-4">
                        <div>
                            <CardTitle className="text-2xl mb-1">V{version.version_number}</CardTitle>
                            <CardDescription>
                                Stage: <Badge variant="outline" className="mr-2">{version.stage}</Badge>
                                Status: <Badge variant="secondary">{version.status}</Badge>
                            </CardDescription>
                        </div>
                        {/* TODO: Add Edit Version Button */} 
                        <Button variant="ghost" size="icon" disabled> 
                            <Pencil className="h-4 w-4" /> 
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {version.notes ? (
                        <p className="whitespace-pre-wrap">{version.notes}</p>
                    ) : (
                        <p className="italic text-muted-foreground">No notes provided for this version.</p>
                    )}
                    <p className="text-sm text-muted-foreground mt-4">
                        Created: {new Date(version.created_at).toLocaleDateString()}
                    </p>
                </CardContent>
            </Card>

            {/* --- Variations Section --- */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Variations</CardTitle>
                        <CardDescription>Variations within this version.</CardDescription>
                    </div>
                    <VariationDialog open={isAddVariationDialogOpen} onOpenChange={setIsAddVariationDialogOpen}>
                        <VariationDialogTrigger asChild>
                             <Button size="sm" disabled={addVariationMutation.isPending || nextVariationLetterDisplay > 'Z'}> 
                                <PlusCircle className="mr-2 h-4 w-4" /> Add Variation
                            </Button>
                        </VariationDialogTrigger>
                        <VariationDialogContent className="sm:max-w-[425px]">
                            <VariationDialogHeader>
                                <VariationDialogTitle>Add New Variation ({nextVariationLetterDisplay})</VariationDialogTitle>
                                <VariationDialogDescription>
Enter optional notes for this new variation. Status will be set to 'Pending Feedback'.
                                </VariationDialogDescription>
                            </VariationDialogHeader>
                            <form onSubmit={handleSubmitVariation(handleAddVariationSubmit)} className="space-y-4">
                                <div className="space-y-1">
                                    <VariationLabel htmlFor="variationNotes">Notes (Optional)</VariationLabel>
                                    <VariationTextarea 
                                        id="variationNotes" 
                                        rows={4}
                                        {...registerVariation("notes")} 
                                        disabled={addVariationMutation.isPending}
                                    />
                                </div>
                                <VariationDialogFooter>
                                    <VariationDialogClose asChild>
                                        <Button type="button" variant="outline" disabled={addVariationMutation.isPending}>Cancel</Button>
                                    </VariationDialogClose>
                                    <Button type="submit" disabled={addVariationMutation.isPending}>
                                        {addVariationMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding...</> : `Add Variation ${nextVariationLetterDisplay}`}
                                    </Button>
                                </VariationDialogFooter>
                            </form>
                        </VariationDialogContent>
                    </VariationDialog>
                </CardHeader>
                <CardContent>
                   {isLoadingVariations ? (
                     <div className="flex justify-center items-center p-4"><Loader2 className="h-6 w-6 animate-spin" /> Loading Variations...</div>
                   ) : variationsError ? (
                     <p className="text-red-600">Error loading variations: {variationsError.message}</p>
                   ) : variations && variations.length > 0 ? (
                     <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Variation</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Created</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {variations.map((variation) => (
                                <TableRow key={variation.id}>
                                    {/* TODO: Link to specific variation page/view? */}
                                    <TableCell className="font-medium">
                                        <Link href={`/projects/${projectId}/designs/${designId}/versions/${versionId}/variations/${variation.id}`} className="hover:underline">
                                            {variation.variation_letter} 
                                        </Link>
                                    </TableCell>
                                    <TableCell><Badge variant="secondary">{variation.status}</Badge></TableCell>
                                    <TableCell className="text-right">
                                        {new Date(variation.created_at).toLocaleDateString()}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                     </Table>
                   ) : (
                     <p className="italic text-muted-foreground text-center p-4">No variations have been created for this version yet.</p>
                   )}
                </CardContent>
            </Card>

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