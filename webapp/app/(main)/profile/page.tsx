'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

// --- Component --- 
const ProfilePage = () => {
  const router = useRouter();
  const { user, profile, loading, loadingProfile, supabase } = useAuth();
  const queryClient = useQueryClient();

  // Local state for editable fields
  const [displayName, setDisplayName] = useState<string>('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  // Update local state when profile data loads
  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name);
    }
  }, [profile]); // Run when profile changes

  // --- Update Profile Mutation ---
  const updateProfileMutation = useMutation<
    unknown, // Define success return type if needed, otherwise unknown
    Error,
    { displayName: string } // Variables passed to mutationFn
  >({
    mutationFn: async ({ displayName }) => {
        if (!user) throw new Error("User not logged in");
        
        const { error } = await supabase
          .from('profiles')
          .update({ 
              display_name: displayName, 
              updated_at: new Date().toISOString()
            })
          .eq('id', user.id);
        
        if (error) throw error; // Let React Query handle the error
    },
    onSuccess: () => {
        toast.success("Profile updated successfully!");
        // You might want to invalidate queries related to the profile here
        // if other parts of the app depend on it
        // queryClient.invalidateQueries({ queryKey: ['profile', user.id] });
    },
    onError: (error: unknown) => {
        toast.error(`Failed to update profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  // --- Handler ---
  const handleProfileUpdate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (displayName !== profile?.display_name) { // Only update if changed
        updateProfileMutation.mutate({ displayName });
    }
  };

  // --- Render Logic ---
  if (loading || loadingProfile) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-150px)]">
        <LoadingSpinner />
      </div>
    );
  }

  if (!user || !profile) {
    return <ErrorMessage message="Could not load user profile." />;
  }

  return (
    <div className="flex justify-center items-start pt-10 min-h-[calc(100vh-150px)]">
       <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Your Profile</CardTitle>
          <CardDescription>
            View and update your profile information.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleProfileUpdate}>
          <CardContent className="grid gap-6">
            {/* Display non-editable info */}
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={profile.email || ''} readOnly disabled />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Role</Label>
              <Input id="role" type="text" value={profile.role} readOnly disabled />
            </div>
             <div className="grid gap-2">
              <Label htmlFor="joined">Joined</Label>
              <Input id="joined" type="text" value={new Date(profile.created_at).toLocaleDateString()} readOnly disabled />
            </div>
            
            {/* Editable display name */}
            <div className="grid gap-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input 
                id="displayName" 
                type="text" 
                placeholder="Your display name" 
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={updateProfileMutation.isPending}
              />
            </div>

             {/* TODO: Add other profile fields (e.g., avatar upload) */}
            
          </CardContent>
          <CardFooter>
             <Button 
                type="submit" 
                disabled={updateProfileMutation.isPending || displayName === profile.display_name}
             >
                {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default ProfilePage; 