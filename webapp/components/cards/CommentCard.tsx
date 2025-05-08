'use client';

import React, { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Comment, Attachment } from '@/types/models'; // Import Attachment type
import { formatDistanceToNow } from 'date-fns';
import { User } from '@supabase/supabase-js'; // Import Supabase User type
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Trash2, Pencil, Check, X, FileText, ChevronDown, ChevronRight } from 'lucide-react'; // Import icons
import { 
    AlertDialog, 
    AlertDialogAction, 
    AlertDialogCancel, 
    AlertDialogContent, 
    AlertDialogDescription, 
    AlertDialogFooter, 
    AlertDialogHeader, 
    AlertDialogTitle, 
    AlertDialogTrigger 
} from '@/components/ui/alert-dialog'; // Import AlertDialog
import { toast } from 'sonner'; // For potential local errors
import { useAuth } from '@/providers/AuthProvider'; // Import useAuth to get supabase client
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { getProcessedImagePath, getPublicImageUrl } from '@/lib/imageUtils';
import { THUMBNAIL_WIDTH, LARGE_WIDTH } from '@/lib/constants/imageConstants';

interface CommentCardProps {
  comment: Comment;
  currentUser: User | null;
  onUpdate: (variables: { commentId: string; newContent: string; onSuccessCallback: () => void }) => void;
  onDelete: (commentId: string) => void;
  isUpdating: boolean;
  isDeleting: boolean;
  onReply: (parentCommentId: string) => void;
  level: number;
  collapsed?: boolean;
  setCollapsed?: (c: boolean) => void;
  numReplies?: number;
}

// Environment variables (needed for image URLs)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const processedBucketName = process.env.NEXT_PUBLIC_SUPABASE_PROCESSED_BUCKET;

// Utility to render mentions with highlight
function renderWithMentions(text: string) {
  return text.split(/(@\w+)/g).map((part, i) =>
    part.startsWith('@') ? (
      <span
        key={i}
        className="text-blue-600 bg-blue-100 rounded px-1 font-semibold hover:underline cursor-pointer"
      >
        {part}
      </span>
    ) : (
      part
    )
  );
}

export const CommentCard = ({ 
    comment, 
    currentUser, 
    onUpdate, 
    onDelete, 
    isUpdating, 
    isDeleting, 
    onReply, 
    level,
    collapsed,
    setCollapsed,
    numReplies
}: CommentCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(comment.content);
  const { supabase } = useAuth();

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

  // Check if the current user is the author
  const isAuthor = currentUser?.id === comment.user_id;

  const handleUpdate = () => {
    if (!editedContent?.trim()) {
      toast.error("Comment cannot be empty.");
      return;
    }
    onUpdate({
      commentId: comment.id,
      newContent: editedContent.trim(),
      onSuccessCallback: () => setIsEditing(false)
    });
  };

  const handleCancelEdit = () => {
    setEditedContent(comment.content); // Reset content
    setIsEditing(false);
  };

  // Function to get public URL for a processed image attachment
  // Takes the ORIGINAL path and the desired size (thumbnail or large for modal)
  const getProcessedAttachmentUrl = (
      originalFilePath: string | null | undefined,
      width: typeof THUMBNAIL_WIDTH | typeof LARGE_WIDTH
  ): string | null => {
      if (!supabaseUrl || !processedBucketName) {
          console.error("Error: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PROCESSED_BUCKET is not set.");
          return null;
      }
      if (!originalFilePath) return null;

      try {
          const processedPath = getProcessedImagePath(originalFilePath, width);
          return getPublicImageUrl(supabaseUrl, processedBucketName, processedPath);
      } catch (error) {
          console.error(`Error generating processed attachment URL for ${originalFilePath}:`, error);
          return null;
      }
  };

  // Old function - can be removed if no longer used elsewhere
  // const getAttachmentUrl = (filePath: string | null): string | null => {
  //     if (!supabase || !filePath) return null;
  //     const { data } = supabase.storage
  //         .from('comment-attachments') // Use the correct bucket name
  //         .getPublicUrl(filePath);
  //     return data?.publicUrl || null;
  // };

  return (
    <div className="relative w-full group">
      {/* Action bar: aligned horizontally with username/avatar */}
      <div className="absolute top-[0.75rem] right-6 flex items-center gap-2 z-10">
        {isAuthor && !isEditing && (
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button 
              variant="ghost" 
              size="icon"
              className="h-5 w-5"
              onClick={() => setIsEditing(true)}
              title="Edit comment"
              disabled={isUpdating || isDeleting}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-5 w-5 text-destructive hover:text-destructive/80"
                  title="Delete comment"
                  disabled={isUpdating || isDeleting}
                >
                  {isDeleting ? <Loader2 className="h-3 w-3 animate-spin"/> : <Trash2 className="h-3 w-3" />}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete this comment.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={() => onDelete(comment.id)} 
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
        {!isEditing && level === 0 && (
          <Button 
            variant="ghost"
            className="h-auto p-1 text-xs text-muted-foreground hover:text-foreground rounded leading-tight"
            onClick={() => onReply(comment.id)} 
            title="Reply to comment"
            disabled={isUpdating || isDeleting}
          >
            Reply
          </Button>
        )}
      </div>
      {/* Main content row: avatar + content, no extra top padding needed */}
      <div className="flex items-start space-x-3 py-3">
        <Avatar className="h-8 w-8">
          <AvatarImage src={userAvatarUrl || undefined} alt={userName} />
          <AvatarFallback>{userInitials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-1">
          {/* Header row: username/time + collapse control absolutely aligned right */}
          <div className="flex flex-col min-w-0">
            <h4 className="text-sm font-semibold truncate max-w-xs">{userName}</h4>
            <div className="relative mt-0.5 min-h-[1.5rem]"> {/* min-h to ensure enough height for button */}
              <p className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo}</p>
              {level === 0 && setCollapsed && typeof collapsed === 'boolean' && typeof numReplies === 'number' && numReplies > 0 && (
                <button
                  onClick={() => setCollapsed(!collapsed)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus:outline-none absolute right-0 top-0"
                  style={{paddingRight: '1.5rem'}} // match right padding of Reply button
                  title={collapsed ? 'Show replies' : 'Hide replies'}
                >
                  {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {collapsed ? `Show replies (${numReplies})` : `Hide replies`}
                </button>
              )}
            </div>
          </div>
          {/* Conditionally render Textarea or static content */} 
          {isEditing ? (
              <div className="space-y-2">
                  <Textarea 
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      rows={3}
                      className="text-sm"
                  />
                  <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={handleCancelEdit} disabled={isUpdating}>
                          Cancel
                      </Button>
                      <Button size="sm" onClick={handleUpdate} disabled={isUpdating || !editedContent?.trim()}>
                          {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                          Save
                      </Button>
                  </div>
              </div>
          ) : (
              <> {/* Wrap content and attachments */}
                  {comment.content && (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {renderWithMentions(comment.content)}
                      </p>
                  )}
                  {/* UPDATED: Display Attachments (with Thumbnails) */}
                  {comment.attachments && comment.attachments.length > 0 && (
                      <div className="mt-2 space-y-1">
                          {comment.attachments.map((attachment) => {
                              const isImage = attachment.file_type?.startsWith('image/');
                              // --- ADDED: Check for GIF --- 
                              const isGif = attachment.file_path?.toLowerCase().endsWith('.gif');

                              // --- MODIFIED: Generate URLs based on type --- 
                              let thumbnailUrl: string | null = null;
                              let largeImageUrl: string | null = null;

                              if (isImage && supabaseUrl && processedBucketName && attachment.file_path) {
                                  if (isGif) {
                                      // For GIFs, point directly to the copied file in the processed bucket
                                      thumbnailUrl = getPublicImageUrl(supabaseUrl, processedBucketName, attachment.file_path);
                                      largeImageUrl = thumbnailUrl; // Large view is the same for GIF
                                  } else {
                                      // For other images, generate processed webp paths
                                      thumbnailUrl = getProcessedAttachmentUrl(attachment.file_path, THUMBNAIL_WIDTH);
                                      largeImageUrl = getProcessedAttachmentUrl(attachment.file_path, LARGE_WIDTH);
                                  }
                              } else if (!isImage && supabaseUrl && processedBucketName && attachment.file_path) {
                                  // Handle non-image files (provide direct download link from original bucket?)
                                  // Let's assume getAttachmentUrl (using original bucket) is suitable here, needs defining/uncommenting
                                  // thumbnailUrl = getAttachmentUrl(attachment.file_path); // Needs original bucket
                                  // For now, let's try getting public URL from processed bucket - might fail if not copied
                                  thumbnailUrl = getPublicImageUrl(supabaseUrl, 'comment-attachments', attachment.file_path); // Point to original bucket
                              }

                              // --- END MODIFIED --- 

                              return isImage && thumbnailUrl ? (
                                  <Dialog key={attachment.id}> {/* Use Dialog for lightbox effect */}
                                      <DialogTrigger asChild>
                                          {/* Thumbnail View */}
                                          <button className="block cursor-pointer p-1 rounded-md hover:bg-muted/60 transition-colors" title={`View ${attachment.file_name}`}>
                                              <img
                                                  src={thumbnailUrl} // Use thumbnail URL here
                                                  alt={attachment.file_name || 'Comment attachment'}
                                                  className="h-16 w-auto max-w-[100px] rounded-lg object-cover border"
                                                  loading="lazy"
                                                  onError={(e) => {
                                                      // Handle thumbnail load error (e.g., show placeholder)
                                                      console.error(`Failed to load thumbnail: ${thumbnailUrl}`);
                                                      (e.target as HTMLImageElement).style.display = 'none'; // Hide broken image
                                                      // Optionally show a placeholder icon here
                                                  }}
                                              />
                                          </button>
                                      </DialogTrigger>
                                      {largeImageUrl && (
                                          <DialogContent className="max-w-4xl max-h-[80vh] p-2 sm:p-4"> {/* Adjust size as needed */}
                                              <DialogTitle className="sr-only">{`View ${attachment.file_name}`}</DialogTitle>
                                              <DialogDescription className="sr-only">{`Full size view of attachment ${attachment.file_name}`}</DialogDescription>
                                              {/* Large Image View inside Modal */}
                                              <div className="relative w-full h-[70vh]"> {/* Adjust height */}
                                                  <img
                                                      src={largeImageUrl} // Use large image URL here
                                                      alt={`Full view: ${attachment.file_name}`}
                                                      className="object-contain w-full h-full rounded-lg"
                                                      loading="lazy"
                                                  />
                                              </div>
                                          </DialogContent>
                                      )}
                                  </Dialog>
                              ) : (
                                  <a
                                      key={attachment.id}
                                      href={thumbnailUrl || '#'} 
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline bg-muted/50 px-2 py-1 rounded-md"
                                      title={`Download ${attachment.file_name}`}
                                  >
                                      <FileText className="h-3 w-3 shrink-0" />
                                      <span className="truncate">{attachment.file_name || 'Attachment'}</span>
                                      {attachment.file_size && (
                                          <span className="text-xs text-muted-foreground/70 ml-auto shrink-0">
                                               ({(attachment.file_size / 1024).toFixed(1)} KB)
                                          </span>
                                      )}
                                  </a>
                              );
                           })}
                      </div>
                  )}
              </>
          )}
        </div>
      </div>
    </div>
  );
}; 