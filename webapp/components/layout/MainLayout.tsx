'use client'; // Header needs to be a client component to use hooks

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/providers/AuthProvider'; // Import useAuth hook
import { Button } from '@/components/ui/button'; // Import Button

// Updated Header Component
const Header = () => {
  const { user, signOut, loading } = useAuth();

  return (
    <header className="bg-gray-800 text-white p-4">
      <div className="container mx-auto flex justify-between items-center">
        <Link href="/" className="text-xl font-bold hover:text-gray-300">
          FeedbackApp
        </Link>
        <nav>
          {loading ? (
            <span className="text-sm">Loading...</span>
          ) : user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm">{user.email}</span>
              <Button variant="secondary" size="sm" onClick={signOut}>
                Sign Out
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Link href="/sign-in" className="text-sm hover:text-gray-300">
                Sign In
              </Link>
              <Link href="/sign-up" className="text-sm hover:text-gray-300">
                Sign Up
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};

// Basic Footer Component (Placeholder)
const Footer = () => (
  <footer className="bg-gray-200 text-gray-700 p-4 mt-auto">
    {/* TODO: Implement Footer Content */}
    <p>Footer</p>
  </footer>
);

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-grow container mx-auto p-4">
        {children}
      </main>
      <Footer />
    </div>
  );
};

export default MainLayout; 