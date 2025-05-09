'use client';

import React, { useEffect, useState } from 'react';
import { useAuth, UserProfile } from '@/providers/AuthProvider';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { SupabaseClient } from '@supabase/supabase-js';

// Define a minimal Supabase client type for type safety
interface MinimalSupabaseClient {
  from: (table: string) => unknown;
}

function hasFromMethod(obj: unknown): obj is MinimalSupabaseClient {
  return typeof obj === 'object' && obj !== null && typeof (obj as MinimalSupabaseClient).from === 'function';
}

function hasMessage(error: unknown): error is { message: string } {
  return typeof error === 'object' && error !== null && 'message' in error && typeof (error as any).message === 'string';
}

// Define a minimal Supabase response type
interface SupabaseResponse<T> {
  data: T;
  error: { message: string } | null;
}

// Function to fetch profiles (can be defined outside component)
const fetchProfiles = async (supabase: unknown): Promise<UserProfile[]> => {
  if (!hasFromMethod(supabase)) {
    throw new Error('Invalid supabase client');
  } else {
    const typedSupabase = supabase as SupabaseClient<any>;
    const result = await (typedSupabase
      .from('profiles')
      .select('id, display_name, email, role, created_at')
      .order('created_at', { ascending: true })
    ) as SupabaseResponse<UserProfile[]>;
    const data: UserProfile[] = result.data;
    const error = result.error;
    if (error) {
      let errorMsg: string;
      if (hasMessage(error)) {
        errorMsg = error.message;
      } else {
        errorMsg = String(error);
      }
      console.error("Error fetching profiles:", errorMsg);
      throw new Error(errorMsg);
    }
    return data || []; // Return data or empty array
  }
};

// Function to update a user's role
const updateProfileRole = async (
  supabase: unknown,
  userId: string,
  newRole: UserProfile['role']
): Promise<UserProfile> => {
  if (!hasFromMethod(supabase)) {
    throw new Error('Invalid supabase client');
  } else {
    const typedSupabase = supabase as SupabaseClient<any>;
    const result = await (typedSupabase
      .from('profiles')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, display_name, email, role, created_at')
      .single()
    ) as SupabaseResponse<UserProfile>;
    const data: UserProfile = result.data;
    const error = result.error;
    if (error) {
      let errorMsg: string;
      if (hasMessage(error)) {
        errorMsg = error.message;
      } else {
        errorMsg = String(error);
      }
      console.error("Error updating profile role:", errorMsg);
      throw new Error(errorMsg);
    }
    if (!data) {
      throw new Error("Failed to update profile role: No data returned.");
    }
    return data;
  }
};

const AdminDashboardPage = () => {
  const { profile: adminProfile, loading, user, supabase } = useAuth();
  const router = useRouter();

  // State to manage the currently selected role for each user row
  const [selectedRoles, setSelectedRoles] = useState<Record<string, UserProfile['role']>>({});

  // Use React Query to fetch profiles
  const { 
    data: profiles, 
    isLoading: isLoadingProfiles, 
  } = useQuery<UserProfile[], Error>({
    queryKey: ['profiles'],
    queryFn: () => fetchProfiles(supabase),
    enabled: !!user && adminProfile?.role === 'admin',
    staleTime: 1000 * 60 * 5,
  });

  // Initialize/Update selectedRoles state when profiles data changes
  useEffect(() => {
      if (profiles) {
          const initialRoles: Record<string, UserProfile['role']> = {};
          profiles.forEach((p: UserProfile) => { initialRoles[p.id] = p.role; });
          if (JSON.stringify(selectedRoles) !== JSON.stringify(initialRoles)) {
             setSelectedRoles(initialRoles);
          }
      }
  }, [profiles, selectedRoles]);

  // Update profile role mutation
  const updateRoleMutation = useMutation<
    UserProfile, // Type of data returned on success
    Error, // Type of error
    { userId: string; newRole: UserProfile['role'] } // Type of variables passed to mutationFn
  >({
    mutationFn: ({ userId, newRole }) => updateProfileRole(supabase, userId, newRole),
    onSuccess: (updatedProfile) => {
      // queryClient.invalidateQueries({ queryKey: ['profiles'] }); // TODO: Add cache invalidation if needed in the future
      toast.success(`Role for ${updatedProfile.email || updatedProfile.id} updated to ${updatedProfile.role}`);
      // No need to manually update selectedRoles here, useEffect above handles it when query refetches
    },
    onError: (error) => {
      toast.error(`Failed to update role: ${error.message}`);
    },
  });

  // Handlers
  const handleRoleChange = (userId: string, newRole: UserProfile['role']) => {
    setSelectedRoles(prev => ({ ...prev, [userId]: newRole }));
  };

  const handleUpdateClick = (userId: string) => {
    const newRole = selectedRoles[userId];
    const currentProfile = profiles?.find((p: UserProfile) => p.id === userId);

    if (newRole && currentProfile && newRole !== currentProfile.role) {
        console.log(`Updating role for ${userId} to ${newRole}`); // Debug log
        updateRoleMutation.mutate({ userId, newRole });
    } else {
        console.log(`Role not changed for ${userId}, skipping update.`); // Debug log
    }
  };

  const isPageLoading = loading;

  useEffect(() => {
    // Redirect non-admins after initial auth loading is done
    if (!isPageLoading && (!user || adminProfile?.role !== 'admin')) {
      router.replace('/');
    }
  }, [isPageLoading, user, adminProfile, router]);

  // Define breadcrumb items for this page

  if (isPageLoading) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-150px)]">
        <LoadingSpinner />
      </div>
    );
  }

  // Check again after loading, redirect should be handled by useEffect
  if (!user || adminProfile?.role !== 'admin') {
    return null;
  }

  // Render admin content
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Admin Dashboard</h1>
      <p className="mb-4">Welcome, Administrator!</p>
      <div className="p-4 border rounded bg-white shadow-sm">
        <h2 className="text-xl font-semibold mb-3">User Management</h2>
        {isLoadingProfiles ? (
          <LoadingSpinner />
        ) : profiles && profiles.length > 0 ? (
          <Table>
            <TableCaption>A list of registered users.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[250px]">User ID</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead> 
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile: UserProfile) => {
                const currentSelectedRole = selectedRoles[profile.id] || profile.role;
                const originalRole = profile.role;
                const isRoleChanged = currentSelectedRole !== originalRole;
                
                return (
                  <TableRow key={profile.id}>
                    <TableCell className="font-mono text-xs">{profile.id}</TableCell>
                    <TableCell>{profile.display_name || '-'}</TableCell>
                    <TableCell>{profile.email}</TableCell>
                    <TableCell>{profile.role}</TableCell>
                    <TableCell>{new Date(profile.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                       <Select 
                         value={currentSelectedRole} 
                         onValueChange={(value) => handleRoleChange(profile.id, value as UserProfile['role'])}
                         disabled={updateRoleMutation.isPending && updateRoleMutation.variables?.userId === profile.id}
                       >
                          <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="designer">Designer</SelectItem>
                            <SelectItem value="client">Client</SelectItem>
                          </SelectContent>
                        </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        size="sm" 
                        onClick={() => handleUpdateClick(profile.id)}
                        disabled={!isRoleChanged || (updateRoleMutation.isPending && updateRoleMutation.variables?.userId === profile.id)}
                        variant={isRoleChanged ? "default" : "outline"}
                      >
                        {(updateRoleMutation.isPending && updateRoleMutation.variables?.userId === profile.id) ? 'Updating...' : 'Update'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p>No users found.</p>
        )}
      </div>
    </div>
  );
};

export default AdminDashboardPage; 