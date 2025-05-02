'use client';

import React, { useEffect, useState } from 'react';
import { useAuth, UserProfile } from '@/providers/AuthProvider';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

// Function to fetch profiles (can be defined outside component)
const fetchProfiles = async (supabase: any): Promise<UserProfile[]> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, email, role, created_at') // Fetch relevant fields
    .order('created_at', { ascending: true }); // Order by creation date

  if (error) {
    console.error("Error fetching profiles:", error);
    throw new Error(error.message);
  }
  return data || []; // Return data or empty array
};

// Function to update a user's role
const updateProfileRole = async (
  supabase: any,
  userId: string,
  newRole: UserProfile['role']
): Promise<UserProfile> => {
  const { data, error } = await supabase
    .from('profiles')
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id, display_name, email, role, created_at') // Select updated data
    .single();

  if (error) {
    console.error("Error updating profile role:", error);
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to update profile role: No data returned.");
  }
  return data;
};

const AdminDashboardPage = () => {
  const { profile: adminProfile, loading, loadingProfile, user, supabase } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  // State to manage the currently selected role for each user row
  const [selectedRoles, setSelectedRoles] = useState<Record<string, UserProfile['role']>>({});

  // Use React Query to fetch profiles
  const { 
    data: profiles, 
    isLoading: isLoadingProfiles, 
    error: profilesError 
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
          // Only update if different to avoid potential loops, though unlikely here
          // A more robust check might involve deep comparison if objects were complex
          if (JSON.stringify(selectedRoles) !== JSON.stringify(initialRoles)) {
             setSelectedRoles(initialRoles);
          }
      }
  }, [profiles]); // Rerun when profiles data changes

  // Update profile role mutation
  const updateRoleMutation = useMutation<
    UserProfile, // Type of data returned on success
    Error, // Type of error
    { userId: string; newRole: UserProfile['role'] } // Type of variables passed to mutationFn
  >({
    mutationFn: ({ userId, newRole }) => updateProfileRole(supabase, userId, newRole),
    onSuccess: (updatedProfile) => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
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

  const isPageLoading = loading || loadingProfile;

  useEffect(() => {
    // Redirect non-admins after initial auth loading is done
    if (!isPageLoading && (!user || adminProfile?.role !== 'admin')) {
      router.replace('/');
    }
  }, [isPageLoading, user, adminProfile, router]);

  // Effect to set selected roles when a user is selected
  useEffect(() => {
    if (selectedUser) {
      // Ensure roles is an array, default to empty if null/undefined
      setSelectedRoles(Array.isArray(selectedUser.roles) ? selectedUser.roles : []);
    } else {
      setSelectedRoles([]); // Clear roles when no user is selected
    }
  }, [selectedUser, selectedRoles]); // Added selectedRoles dependency

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
        ) : profilesError ? (
          <ErrorMessage message={`Failed to load profiles: ${profilesError.message}`} />
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