'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import Link from 'next/link';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { PlusCircle, ListFilter, ArrowUpDown, Loader2 } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
// import { User } from '@supabase/supabase-js';
// import { useSupabaseClient } from '@supabase/auth-helpers-react';

// --- Updated Type Definitions ---
// Use statuses from DB schema
type ProjectStatus = 'Pending' | 'In Progress' | 'In Review' | 'Approved' | 'Needs Changes' | 'Completed' | 'Archived';

type Project = {
  id: string;
  client_id: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  // Change back to single object based on console log
  clients: { id: string; name: string } | null; 
};

type SortColumn = 'name' | 'client_name' | 'status' | 'created_at';
type SortDirection = 'asc' | 'desc';

// Type for Client (used for filter dropdown)
type ClientFilter = {
  id: string;
  name: string;
};

// Type for inserting a new project
type NewProject = {
  name: string;
  client_id: string | null; // Allow null
  description?: string | null;
  // status defaults to 'Pending' in the database schema
};

// --- Zod Schema for New Project Form ---
const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  // Keep client_id as optional/nullable UUID in the schema
  client_id: z.string().uuid('Invalid client selection').nullable().optional(), 
  description: z.string().optional(),
});

// --- Fetch Projects Hook (Use useAuth) ---
const useProjects = (userId: string | undefined) => {
  const { supabase } = useAuth(); 

  return useQuery({
    queryKey: ['projects', userId],
    queryFn: async (): Promise<Project[]> => {
      if (!supabase) throw new Error("Supabase client not available"); 
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
        .order('created_at', { ascending: false });

      // Remove console log
      // console.log("[useProjects] Raw data fetched:", data); 

      if (error) {
        console.error('Error fetching projects:', error);
        throw new Error(error.message);
      }
      // Use updated Project type here, casting through unknown first
      return (data as unknown as Project[]) || []; 
    },
    enabled: !!supabase && !!userId, 
  });
};

// --- Fetch Clients Hook (Use useAuth) ---
const useClientsForFilter = () => {
  const { supabase } = useAuth(); // Use useAuth
  
  return useQuery({
    queryKey: ['clientsForFilter'],
    queryFn: async (): Promise<ClientFilter[]> => {
      if (!supabase) throw new Error("Supabase client not available");
      const { data, error } = await supabase.from('clients').select('id, name').order('name');
      if (error) {
        console.error('Error fetching clients for filter:', error);
        throw new Error(error.message);
      }
      return data || [];
    },
    enabled: !!supabase,
  });
};

// Updated Project Statuses Enum values from DB Schema
const projectStatuses: ProjectStatus[] = ['Pending', 'In Progress', 'In Review', 'Approved', 'Needs Changes', 'Completed', 'Archived'];

// --- Add Project Hook (Use useAuth) ---
const useAddProject = () => {
  const { supabase } = useAuth(); // Use useAuth
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (newProject: NewProject) => {
        if (!supabase) throw new Error("Supabase client not available");
        // Ensure client_id is passed correctly (null if empty)
        const insertData = { ...newProject, client_id: newProject.client_id || null };
        const { data, error } = await supabase
          .from('projects')
          .insert(insertData) // Use prepared data
          .select()
          .single();
        
        if (error) {
            console.error('Error adding project:', error);
            throw new Error(`Failed to add project: ${error.message}`);
        }
        return data;
    },
    onSuccess: () => {
        toast.success('Project added successfully!');
        queryClient.invalidateQueries({ queryKey: ['projects'] }); // Refetch projects list
    },
    onError: (error) => {
        toast.error(error.message);
    },
  });
};

// --- Dashboard Page Component ---
export default function DashboardPage() {
  const { user, loadingProfile, profile } = useAuth();
  const { data: projects, isLoading: isLoadingProjects, error: projectsError } = useProjects(user?.id);
  const { data: clientsForFilter, isLoading: isLoadingClients } = useClientsForFilter();
  const addProjectMutation = useAddProject();

  // State for filters
  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  // State for search
  const [searchTerm, setSearchTerm] = useState<string>('');
  // State for sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  // State for Add Project Dialog
  const [isAddProjectDialogOpen, setIsAddProjectDialogOpenDirect] = useState(false);

  // Form hook for Add Project
  const {
    register,
    handleSubmit,
    reset: resetProjectForm,
    control,
    formState: { errors: projectFormErrors },
  } = useForm<z.infer<typeof projectSchema>>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: '',
      client_id: null, // Actual default is null
      description: '',
    },
  });

  // --- Sorting Handler ---
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column is clicked
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Default to ascending when changing column
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Memoized filtered and sorted projects
  const processedProjects = useMemo(() => {
    if (!projects) return [];

    // 1. Filter by Client and Status
    let filtered = projects.filter(project => {
      const clientMatch = selectedClientId === 'all' || project.client_id === selectedClientId;
      const statusMatch = selectedStatus === 'all' || project.status === selectedStatus;
      return clientMatch && statusMatch;
    });

    // 2. Filter by Search Term
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      filtered = filtered.filter(project => 
        project.name.toLowerCase().includes(lowerSearchTerm) ||
        project.clients?.name?.toLowerCase().includes(lowerSearchTerm) // Use direct property access
        // Add description search if needed: || project.description?.toLowerCase().includes(lowerSearchTerm)
      );
    }

    // 3. Sort
    filtered.sort((a, b) => {
      let valA: string | number | null | undefined;
      let valB: string | number | null | undefined;

      switch (sortColumn) {
        case 'name':
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          break;
        case 'client_name':
          valA = a.clients?.name?.toLowerCase(); // Use direct property access
          valB = b.clients?.name?.toLowerCase();
          break;
        case 'status':
          valA = a.status;
          valB = b.status;
          break;
        case 'created_at':
          valA = new Date(a.created_at).getTime();
          valB = new Date(b.created_at).getTime();
          break;
        default:
          return 0; // Should not happen
      }
      
      // Handle null/undefined values during sort
      valA = valA ?? ''; 
      valB = valB ?? '';

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [projects, selectedClientId, selectedStatus, searchTerm, sortColumn, sortDirection]);

  // --- Render Sort Indicator --- 
  const renderSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return <ArrowUpDown className="ml-2 h-4 w-4 opacity-30" />;
    return sortDirection === 'asc' 
      ? <ArrowUpDown className="ml-2 h-4 w-4 text-foreground" /> 
      : <ArrowUpDown className="ml-2 h-4 w-4 text-foreground opacity-60" />; // Slightly different visual for desc
  };

  // --- Handler for Add Project Form Submit ---
  const handleAddProjectSubmit = (values: z.infer<typeof projectSchema>) => {
    // Convert "none" or undefined back to null before mutation
    const clientIdToSend = (values.client_id === 'none' || values.client_id == null) ? null : values.client_id;
    
    addProjectMutation.mutate(
      { ...values, client_id: clientIdToSend }, 
      {
        onSuccess: () => {
          resetProjectForm({ name: '', description: '', client_id: null }); // Reset form with null client_id
          setIsAddProjectDialogOpenDirect(false);
        },
      }
    );
  };

  // --- Handler for Add Project Dialog Close ---
  const handleAddProjectDialogClose = () => {
    resetProjectForm(); // Reset form when dialog closes
    setIsAddProjectDialogOpenDirect(false);
  }

  if (isLoadingProjects) {
    return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (projectsError) {
    return <div className="text-red-600 p-4">Error loading projects: {projectsError.message}</div>;
  }

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Project Dashboard</h1>
        {/* Only show Add Project button if user is logged in? Add role check later? */}
        {user && (
          <Dialog open={isAddProjectDialogOpen} onOpenChange={handleAddProjectDialogClose}>
            <DialogTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Project
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                <DialogTitle>Add New Project</DialogTitle>
                <DialogDescription>
                    Fill in the details for the new project.
                </DialogDescription>
                </DialogHeader>
                {/* Add Project Form using react-hook-form */}
                <form onSubmit={handleSubmit(handleAddProjectSubmit)} className="space-y-4">
                    {/* Project Name Input */}
                    <div className="space-y-1">
                        <Label htmlFor="projectName">Project Name *</Label>
                        <Input 
                            id="projectName" 
                            {...register("name")} 
                            disabled={addProjectMutation.isPending}
                        />
                        {projectFormErrors.name && <p className="text-xs text-red-600">{projectFormErrors.name.message}</p>}
                    </div>
                    {/* Client Select */}
                    <div className="space-y-1">
                        <Label htmlFor="projectClient">Client</Label>
                         <Controller
                            name="client_id"
                            control={control}
                            render={({ field }) => (
                                <Select 
                                    onValueChange={(value: string) => { // Value from Select is always string
                                      field.onChange(value === "none" ? null : value);
                                    }}
                                    // Ensure Select value is always string: UUID or "none"
                                    value={field.value === null || field.value === undefined ? "none" : field.value} 
                                    disabled={isLoadingClients || addProjectMutation.isPending}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={isLoadingClients ? "Loading..." : "Select client (optional)"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {/* Use "none" as the value for the placeholder item */}
                                        <SelectItem value="none">-- No Client --</SelectItem> 
                                        {clientsForFilter?.map((client) => (
                                            <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        {projectFormErrors.client_id && <p className="text-xs text-red-600">{projectFormErrors.client_id.message}</p>}
                    </div>
                    {/* Description Textarea */}
                    <div className="space-y-1">
                        <Label htmlFor="projectDescription">Description</Label>
                        <Textarea 
                            id="projectDescription" 
                            {...register("description")} 
                            disabled={addProjectMutation.isPending}
                        />
                    </div>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button type="button" variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={addProjectMutation.isPending}>
                            {addProjectMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding...</> : "Add Project"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Filter Controls */}
      <div className="flex gap-2 flex-wrap">
          {/* Search Input */}
          <div className="flex-grow">
            <Input 
                placeholder="Search by project or client name..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {/* Client Filter */}
          <Select value={selectedClientId} onValueChange={setSelectedClientId} disabled={isLoadingClients}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by client..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clientsForFilter?.map(client => (
                  <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Status Filter */}
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {projectStatuses.map(status => (
                  <SelectItem key={status} value={status}>{status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" disabled>
            <ListFilter className="h-4 w-4" />
          </Button>
      </div>

      {/* Projects Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => handleSort('name')}>
                  Project Name {renderSortIndicator('name')}
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('client_name')}>
                  Client {renderSortIndicator('client_name')}
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('status')}>
                  Status {renderSortIndicator('status')}
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('created_at')}>
                  Created {renderSortIndicator('created_at')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {processedProjects && processedProjects.length > 0 ? (
              processedProjects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="font-medium">
                    <Link 
                      href={`/projects/${project.id}`}
                      className="hover:underline text-blue-600"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell>{project.clients?.name ?? <span className="text-muted-foreground">N/A</span>}</TableCell>
                  <TableCell>{project.status}</TableCell>
                  <TableCell className="text-right">
                    {new Date(project.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No projects found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
} 