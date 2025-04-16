"use client";

import { useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from '@/components/ui/button';
import Link from 'next/link';

// Define types
interface Client {
  id: string;
  name: string;
}

interface NewProjectForm {
  name: string;
  description: string;
  client_id: string | null; // Can be null if no client is selected
}

// Fetch function for clients
const fetchClients = async (supabase: any): Promise<Client[]> => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) {
    console.error("Error fetching clients:", error);
    throw new Error('Failed to fetch clients');
  }
  return data || [];
};

export default function NewProjectPage() {
  const { supabase } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [formData, setFormData] = useState<NewProjectForm>({ name: '', description: '', client_id: null });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Query to fetch clients for the dropdown
  const { data: clients, isLoading: isLoadingClients, error: clientsError } = useQuery({
    queryKey: ['clients'],
    queryFn: () => fetchClients(supabase),
    enabled: !!supabase, // Only run if supabase client is available
  });

  // Mutation to create a new project
  const createProjectMutation = useMutation({
    mutationFn: async (newProject: NewProjectForm) => {
      setIsSubmitting(true);
      const { data, error } = await supabase
        .from('projects')
        .insert([
          {
            name: newProject.name,
            description: newProject.description || null,
            client_id: newProject.client_id || null,
            // status defaults to 'Pending'
            // created_by defaults to auth.uid()
          },
        ])
        .select()
        .single();

      if (error) {
        throw error;
      }
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Project "${data.name}" created successfully!`);
      // Optionally invalidate queries related to projects list
      // queryClient.invalidateQueries(['projects']);
      router.push('/dashboard'); // Redirect after creation
    },
    onError: (error) => {
      console.error("Error creating project:", error);
      toast.error(`Failed to create project: ${error.message}`);
    },
    onSettled: () => {
      setIsSubmitting(false);
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Handler for Select component change
  const handleClientChange = (value: string) => {
    setFormData((prev) => ({ ...prev, client_id: value || null }));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formData.name) {
        toast.error('Project name is required.');
        return;
    }
    createProjectMutation.mutate(formData);
  };

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Add New Project</CardTitle>
          <CardDescription>Enter the details for the new project.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {/* Project Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Project Name *</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Enter project name"
                required
                disabled={isSubmitting}
              />
            </div>
            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Enter project description (optional)"
                disabled={isSubmitting}
              />
            </div>
            {/* Client Select */}
            <div className="space-y-2">
              <Label htmlFor="client_id">Assign Client</Label>
              <Select
                name="client_id"
                value={formData.client_id || ''} // Ensure value is string or empty string for Select
                onValueChange={handleClientChange}
                disabled={isLoadingClients || isSubmitting || !clients || clients.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingClients ? "Loading clients..." : "Select a client (optional)"} />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingClients ? (
                    <SelectItem value="loading" disabled>Loading...</SelectItem>
                  ) : clientsError ? (
                    <SelectItem value="error" disabled>Error loading clients</SelectItem>
                  ) : clients && clients.length > 0 ? (
                    clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-clients" disabled>No clients available. Add one first.</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {clientsError && (
                 <p className="text-sm text-red-600">Could not load clients.</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" asChild>
                <Link href="/dashboard">Cancel</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting || isLoadingClients}>
              {isSubmitting ? 'Creating...' : 'Create Project'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
} 