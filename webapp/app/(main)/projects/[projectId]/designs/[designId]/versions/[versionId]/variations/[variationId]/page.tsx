'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from "@/components/ui/badge";
import { Loader2 } from 'lucide-react'; // Import necessary icons later (e.g., Pencil for edit)
import Link from 'next/link';
import Breadcrumbs, { BreadcrumbItem } from '@/components/ui/breadcrumbs';
// Import Button later if needed for actions
// import { Button } from '@/components/ui/button';

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

// --- Component ---
export default function VariationDetailPage() {
    const { supabase } = useAuth();
    const params = useParams();
    const projectId = params.projectId as string;
    const designId = params.designId as string;
    const versionId = params.versionId as string;
    const variationId = params.variationId as string;

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
                            <CardDescription>
                                Status: <Badge variant="secondary">{variation.status}</Badge>
                                {/* TODO: Add dropdown to change variation status */}
                            </CardDescription>
                        </div>
                        {/* TODO: Add Edit Variation Button */} 
                        {/* <Button variant="ghost" size="icon" disabled> 
                            <Pencil className="h-4 w-4" /> 
                        </Button> */} 
                    </div>
                </CardHeader>
                <CardContent>
                    {variation.notes ? (
                        <p className="whitespace-pre-wrap mb-4">Notes: {variation.notes}</p>
                    ) : (
                        <p className="italic text-muted-foreground mb-4">No notes provided for this variation.</p>
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