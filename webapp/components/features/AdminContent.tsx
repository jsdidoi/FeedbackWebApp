'use client';

import React from 'react';
import { useAuth } from '@/providers/AuthProvider';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const AdminContent = () => {
  const { profile, loadingProfile, user } = useAuth();

  // Show loading state while profile is being fetched
  if (loadingProfile) {
    return <LoadingSpinner />;
  }

  // Check if user is logged in and has the admin role
  if (user && profile?.role === 'admin') {
    return (
      <div className="p-4 my-4 border rounded border-yellow-500 bg-yellow-50">
        <h2 className="font-bold text-lg mb-2">Admin Only Content</h2>
        <p>This content is only visible to users with the &#39;admin&#39; role.</p>
        <p>Your role: {profile.role}</p>
      </div>
    );
  }

  // Return null or some other content if user is not an admin
  return null;
};

export default AdminContent; 