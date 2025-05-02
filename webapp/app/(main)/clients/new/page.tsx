"use client";

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useAuth } from '@/providers/AuthProvider';

// Define the type for the form data
interface NewClientForm {
  name: string;
  contact_info: string;
}

export default function NewClientPage() {
  // Get Supabase client from the useAuth hook
  const { supabase } = useAuth();
  // Log the client object to check its validity
  console.log("[NewClientPage] Supabase client from useAuth:", supabase);

  const router = useRouter();
  const [formData, setFormData] = useState<NewClientForm>({ name: '', contact_info: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createClientMutation = useMutation({
    mutationFn: async (newClient: NewClientForm) => {
      setIsSubmitting(true);
      console.log("[MutationFn] Attempting to insert:", newClient); // Log input
      const { data, error } = await supabase
        .from('clients')
        .insert([
          {
            name: newClient.name,
            contact_info: newClient.contact_info || null,
            // created_by is set by default policy in Supabase
          },
        ])
        .select() // Select the newly created record
        .single(); // Expecting a single record back

      // Log the raw result from Supabase
      console.log("[MutationFn] Supabase response:", { data, error }); 

      if (error) {
        // Log the specific error *before* throwing
        console.error("[MutationFn] Supabase Insert Error:", error); 
        throw error; // Re-throw for React Query
      }
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Client "${data.name}" created successfully!`);
      router.push('/dashboard'); // Redirect to dashboard or a client list page after creation
    },
    onError: (error) => {
      console.error("Error creating client:", error);
      toast.error(`Failed to create client: ${error instanceof Error ? error.message : 'An unknown error occurred'}`);
    },
    onSettled: () => {
      setIsSubmitting(false);
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formData.name) {
        toast.error('Client name is required.');
        return;
    }
    createClientMutation.mutate(formData);
  };

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Add New Client</CardTitle>
          <CardDescription>Enter the details for the new client.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Client Name *</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Enter client name"
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_info">Contact Info (Email)</Label>
              <Input
                id="contact_info"
                name="contact_info"
                type="email"
                value={formData.contact_info}
                onChange={handleChange}
                placeholder="Enter contact email (optional)"
                disabled={isSubmitting}
              />
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" asChild>
                <Link href="/dashboard">Cancel</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Client'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
} 