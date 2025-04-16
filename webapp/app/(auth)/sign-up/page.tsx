'use client';

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from '@/providers/AuthProvider';
import Link from 'next/link'; // Import Link for navigation

const SignUpPage = () => {
  const { supabase } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        // Optional: Add options like redirect URL or user metadata here
        // options: {
        //   emailRedirectTo: `${window.location.origin}/`,
        // }
      });

      if (error) {
        setError(error.message);
      } else {
        // Check if email confirmation is required
        if (data.user && data.user.identities?.length === 0) {
           // This case might occur if user exists but is unconfirmed (e.g., social sign up previously)
           // Supabase might return a user object even if confirmation is needed for email/password sign up
           setMessage("Sign up successful, but user seems to exist or requires confirmation. Please check your email or try signing in.");
        } else if (data.session) {
           // If a session is returned immediately, email confirmation might be disabled.
           setMessage("Sign up successful! You are now logged in.");
           // Potentially redirect here if appropriate, e.g., router.push('/')
        } else {
           // Standard case: User created, email confirmation needed
           setMessage("Sign up successful! Please check your email for the confirmation link.");
        }
      }
    } catch (err) {
      setError("An unexpected error occurred during sign up.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-[calc(100vh-150px)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Sign Up</CardTitle>
          <CardDescription>
            Enter your email and password to create an account.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSignUp}>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="m@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6} // Good practice to enforce minimum password length
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            {error && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}
            {message && (
              <p className="text-sm font-medium text-green-600">{message}</p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing Up...' : 'Sign Up'}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Already have an account?{" "}
              <Link href="/sign-in" className="underline underline-offset-2 hover:text-primary">
                Sign In
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default SignUpPage; 