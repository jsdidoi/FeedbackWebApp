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

  // Function to get public URL for an attachment
  // IMPORTANT: This uses public URLs based on the current setup.
  // Will need adjustment when bucket security is changed later.
  const getAttachmentUrl = (filePath: string | null): string | null => {
      if (!supabase || !filePath) return null;
      const { data } = supabase.storage
          .from('comment-attachments') // Use the correct bucket name
          .getPublicUrl(filePath);
      return data?.publicUrl || null;
  };

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
                              const fileUrl = getAttachmentUrl(attachment.file_path);
                              const isImage = attachment.file_type?.startsWith('image/');

                              // Render image thumbnail or file link based on type
                              return isImage && fileUrl ? (
                                  <Dialog key={attachment.id}> {/* Use Dialog for lightbox effect */}
                                      <DialogTrigger asChild>
                                          <button className="block cursor-pointer p-1 rounded-md hover:bg-muted/60 transition-colors" title={`View ${attachment.file_name}`}>
                                              <img 
                                                  src={fileUrl}
                                                  alt={attachment.file_name || 'Comment attachment'}
                                                  className="h-16 w-16 object-cover rounded-md border" // Thumbnail styling
                                              />
                                          </button>
                                      </DialogTrigger>
                                      <DialogContent className="max-w-3xl p-2"> {/* Adjust size as needed */}
                                          {/* Add VisuallyHidden Title for Accessibility */}
                                          <VisuallyHidden>
                                              <DialogTitle>{attachment.file_name || 'Attached Image'}</DialogTitle>
                                              <DialogDescription>Full view of the attached image.</DialogDescription> 
                                          </VisuallyHidden>
                                          <img 
                                              src={fileUrl} 
                                              alt={attachment.file_name || 'Comment attachment'} 
                                              className="max-w-full max-h-[80vh] mx-auto object-contain" // Full image styling
                                          />
                                      </DialogContent>
                                  </Dialog>
                              ) : (
                                  <a
                                      key={attachment.id}
                                      href={fileUrl || '#'} 
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