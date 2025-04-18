'use client';

import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Comment } from '@/types/models'; // Assuming Comment type is defined here
import { formatDistanceToNow } from 'date-fns';

interface CommentCardProps {
  comment: Comment;
}

export const CommentCard = ({ comment }: CommentCardProps) => {
  const timeAgo = comment.created_at 
    ? formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })
    : '';

  // Function to get initials from username
  const getInitials = (name: string | undefined | null): string => {
    if (!name) return '?';
    const names = name.split(' ');
    if (names.length > 1) {
      return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
    } else if (names.length === 1 && names[0].length > 0) {
      return names[0][0].toUpperCase();
    }
    return '?';
  };

  const userName = comment.profiles?.display_name || 'Unknown User';
  const userAvatarUrl = comment.profiles?.avatar_url;
  const userInitials = getInitials(userName);

  return (
    <div className="flex items-start space-x-3 py-3">
      <Avatar className="h-8 w-8">
        <AvatarImage src={userAvatarUrl || undefined} alt={userName} />
        <AvatarFallback>{userInitials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">{userName}</h4>
          <p className="text-xs text-muted-foreground">{timeAgo}</p>
        </div>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {comment.content}
        </p>
      </div>
    </div>
  );
}; 