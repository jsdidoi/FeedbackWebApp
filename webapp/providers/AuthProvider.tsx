'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session, User, SupabaseClient } from '@supabase/supabase-js';
// import { supabase } from '@/lib/supabaseClient'; // No longer using this
import { createBrowserClient } from '@supabase/ssr'; // Import browser client

// Define the structure of the profile data we expect
export interface UserProfile {
  id: string;
  display_name: string | null;
  email: string | null;
  role: 'admin' | 'designer' | 'client'; // Use the enum values
  created_at: string; // Add created_at field
  // Add other profile fields here if needed
}

interface AuthContextType {
  supabase: SupabaseClient; // Expose the client if needed elsewhere
  session: Session | null;
  user: User | null;
  profile: UserProfile | null; // Add profile state
  loading: boolean;
  loadingProfile: boolean; // Add loading state for profile
  signOut: () => Promise<void>;
}

// Create the context with a default value
const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  // Create Supabase client inside the component using useState
  const [supabase] = useState(() =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  );

  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null); // Profile state
  const [loading, setLoading] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false); // Profile loading state

  console.log(`[AuthProvider] Initial State: loading=${loading}, loadingProfile=${loadingProfile}`);

  // Function to fetch profile data
  const fetchProfile = useCallback(async (userId: string) => {
    console.log(`[AuthProvider] Starting fetchProfile for user: ${userId}`);
    setLoadingProfile(true);
    try {
      const { data, error, status } = await supabase
        .from('profiles')
        .select(`id, display_name, email, role`)
        .eq('id', userId)
        .single();

      if (error && status !== 406) {
        // 406 status means no rows found, which can happen briefly
        console.error('Error fetching profile:', error);
        setProfile(null);
      } else {
        setProfile(data as UserProfile);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    } finally {
      console.log(`[AuthProvider] fetchProfile finished for user: ${userId}. Setting loadingProfile=false.`);
      setLoadingProfile(false);
    }
  }, [supabase]);

  useEffect(() => {
    console.log("[AuthProvider] useEffect running...");

    // Combined initialization function
    const initializeAuthAndProfile = async () => {
      console.log("[AuthProvider] initializeAuthAndProfile starting...");
      setLoading(true); // Ensure loading is true at start
      setLoadingProfile(false); // Reset profile loading
      setProfile(null); // Reset profile

      // Get session first
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log("[AuthProvider] getSession completed. Session exists:", !!session);
      setSession(session);
      setUser(session?.user ?? null);

      // If session exists, *then* fetch profile
      if (session?.user) {
        await fetchProfile(session.user.id);
      }

      // Only set main loading to false *after* session check and potential profile fetch
      console.log("[AuthProvider] initializeAuthAndProfile finished. Setting loading=false.");
      setLoading(false);
    };

    initializeAuthAndProfile();

    // Listen for auth state changes (simplified)
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        console.log(`[AuthProvider] onAuthStateChange event: ${_event}`);
        // Directly update session and user state
        setSession(session);
        setUser(session?.user ?? null);

        // If signing out, clear profile state and reload
        if (_event === 'SIGNED_OUT') {
          console.log("[AuthProvider] SIGNED_OUT detected. Clearing profile and reloading.");
          setProfile(null);
          // Reload happens via window.location.reload() in listener
          window.location.reload();
        }
        // We might need to re-fetch profile on SIGNED_IN if session was previously null,
        // but let's see if initial load covers it first.
      }
    );

    // Cleanup listener
    return () => {
      console.log("[AuthProvider] useEffect cleanup.");
      authListener?.subscription.unsubscribe();
    };
  }, [supabase, fetchProfile]);

  const signOut = async () => {
    await supabase.auth.signOut();
    // Listener handles state update and reload
  };

  const value = {
    supabase,
    session,
    user,
    profile,
    loading,
    loadingProfile,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook to use the AuthContext
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 