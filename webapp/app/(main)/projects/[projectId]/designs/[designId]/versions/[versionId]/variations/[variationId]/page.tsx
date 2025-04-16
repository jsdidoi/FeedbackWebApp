'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from "@/components/ui/badge";
import { Loader2, Pencil } from 'lucide-react';
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
    // Add fields for image/file later, e.g., file_url?: string;
};

// --- Zod Schema for Editing Variation ---
const variationEditSchema = zod.object({
  notes: zod.string().optional(),
  status: zod.enum(variationFeedbackStatuses),
});
type VariationEditFormData = zod.infer<typeof variationEditSchema>;

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
        .select('id, version_id, variation_letter, notes, status, created_at') // Select needed fields
        .eq('id', variationId)
        .single();
    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching variation:', error);
        throw new Error(error.message);
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

    // --- Mutations ---
    const updateVariationMutation = useUpdateVariation(variationId);

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

            {/* Placeholder for Variation Image/Content Display */}
            <Card className="aspect-video flex items-center justify-center bg-muted/30">
                 <p className="text-muted-foreground italic">Variation Image/Content Area</p>
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
                                    {isSubmittingVariationEdit || updateVariationMutation.isPending ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
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