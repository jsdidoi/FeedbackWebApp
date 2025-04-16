'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabaseClient } from '@supabase/auth-helpers-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { Loader2, PlusCircle } from 'lucide-react';
import Breadcrumbs, { BreadcrumbItem } from '@/components/ui/breadcrumbs';

// --- Manual Type Definitions (Workaround) ---
// Based on the 'clients' table schema we created
type Client = {
  id: string; // uuid is typically string in JS/TS
  name: string;
  contact_info: string | null;
  created_at: string; // timestamptz is string
  updated_at: string;
  // Add created_by: string | null; if you uncommented that in the SQL
};

type NewClient = {
  name: string;
  contact_info?: string | null; // Optional fields marked with ?
  // Supabase handles id, created_at, updated_at automatically on insert
};
// --- End Manual Type Definitions ---

// Zod schema for validation
const clientSchema = z.object({
  name: z.string().min(1, 'Client name is required'),
  contact_info: z.string().optional(), // Assuming contact info is optional for now
});

// --- Fetch Clients Hook ---
const useClients = () => {
  const supabase = useSupabaseClient();
  if (!supabase) throw new Error("Supabase client not available");
  return useQuery({
    queryKey: ['clients'],
    queryFn: async (): Promise<Client[]> => {
      const { data, error } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
      if (error) {
        console.error('Error fetching clients:', error);
        throw new Error(error.message);
      }
      return data || [];
    },
  });
};

// --- Add Client Hook ---
const useAddClient = () => {
  const supabase = useSupabaseClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (newClient: NewClient) => {
      if (!supabase) throw new Error("Supabase client not available");
      const { data, error } = await supabase
        .from('clients')
        .insert(newClient)
        .select()
        .single(); // Assuming insert returns the created row

      if (error) {
        console.error('Error adding client:', error);
        throw new Error(`Failed to add client: ${error.message}`);
      }
      return data;
    },
    onSuccess: () => {
      toast.success('Client added successfully!');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
};

// --- Clients Page Component ---
export default function ClientsPage() {
  const [isAddClientDialogOpen, setIsAddClientDialogOpen] = useState(false);
  const { data: clients, isLoading: isLoadingClients, error: clientsError } = useClients();
  const addClientMutation = useAddClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.infer<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: '',
      contact_info: '',
    },
  });

  // Define breadcrumb items for this page
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Admin', href: '/admin' }, // Link to main admin page if it exists
    { label: 'Clients' } // Current page, no link
  ];

  const handleAddClientSubmit = (values: z.infer<typeof clientSchema>) => {
    addClientMutation.mutate(values, {
      onSuccess: () => {
        reset(); // Reset form on success
        setIsAddClientDialogOpen(false); // Close dialog on success
      },
    });
  };

  const handleDialogClose = () => {
    reset(); // Reset form when dialog is closed manually
    setIsAddClientDialogOpen(false);
  }

  return (
    <div className="container mx-auto py-10">
      {/* Add Breadcrumbs component here */}
      <Breadcrumbs items={breadcrumbItems} />

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Manage Clients</h1>
        <Dialog open={isAddClientDialogOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button onClick={() => setIsAddClientDialogOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Client
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Client</DialogTitle>
              <DialogDescription>
                Enter the details for the new client. Click save when you're done.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(handleAddClientSubmit)}>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">
                    Name
                  </Label>
                  <div className="col-span-3">
                    <Input
                      id="name"
                      {...register('name')}
                      className={errors.name ? 'border-red-500' : ''}
                    />
                    {errors.name && (
                      <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="contact_info" className="text-right">
                    Contact Info
                  </Label>
                   <div className="col-span-3">
                    <Input
                      id="contact_info"
                      {...register('contact_info')}
                    />
                     {/* Optional field, no error display needed unless specific validation added */}
                  </div>
                </div>
              </div>
              <DialogFooter>
                 <DialogClose asChild>
                   <Button type="button" variant="outline" onClick={handleDialogClose}>Cancel</Button>
                 </DialogClose>
                <Button type="submit" disabled={addClientMutation.isPending}>
                  {addClientMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Client
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoadingClients && <p>Loading clients...</p>}
      {clientsError && <p className="text-red-500">Error loading clients: {clientsError.message}</p>}

      {!isLoadingClients && !clientsError && clients && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Contact Info</TableHead>
              <TableHead>Created At</TableHead>
              {/* Add Actions column later */}
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.length > 0 ? (
              clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium truncate" title={client.id}>{client.id.substring(0, 8)}...</TableCell>
                  <TableCell>{client.name}</TableCell>
                  <TableCell>{client.contact_info || '-'}</TableCell>
                   <TableCell>{new Date(client.created_at).toLocaleDateString()}</TableCell>
                  {/* Actions Cell */}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No clients found. Add one to get started!
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
} 