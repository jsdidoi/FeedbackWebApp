// webapp/types/models.ts

// --- Project Types ---
export type ProjectStatus = 'Pending' | 'In Progress' | 'In Review' | 'Approved' | 'Needs Changes' | 'Completed' | 'Archived';

export type Project = {
    id: string;
    client_id: string | null;
    name: string;
    description: string | null;
    status: ProjectStatus;
    created_at: string;
    updated_at: string;
    clients?: { id: string; name: string } | null; // Optional client relation
};

// --- Design Types ---
// Define DesignStage as a TypeScript enum
export enum DesignStage {
    Sketch = 'sketch',
    Refine = 'refine',
    Color = 'color',
    Final = 'final'
}

export const designOverallStatuses = ['Active', 'On Hold', 'Completed', 'Archived'] as const;
export type DesignOverallStatus = typeof designOverallStatuses[number];

export type Design = {
    id: string;
    project_id: string;
    name: string;
    description: string | null;
    status: DesignOverallStatus;
    created_at: string;
    updated_at: string;
    created_by: string; // Assuming this links to a user ID
    stage: DesignStage;
    latest_thumbnail_path?: string | null; // Added optional field for RPC result
};

// Type for inserting a new design (used on Project page)
export type NewDesignData = {
    project_id: string;
    name: string;
    // stage might default in DB or be added later
};

// --- Version Types ---
// Define VersionRoundStatus as a TypeScript enum
export enum VersionRoundStatus {
    WorkInProgress = 'Work in Progress',
    ReadyForReview = 'Ready for Review',
    FeedbackReceived = 'Feedback Received',
    RoundComplete = 'Round Complete'
}

export type Version = {
    id: string;
    design_id: string;
    version_number: number; 
    notes: string | null;
    stage: DesignStage;
    status: VersionRoundStatus;
    created_at: string;
    updated_at?: string; // Optional, might not be selected everywhere
};

// Type for inserting a new version (used on Design page)
export type NewVersionData = {
    design_id: string;
    version_number: number;
    notes: string | null;
    stage: DesignStage;
    status: VersionRoundStatus;
};

// --- Variation Types ---
// Define VariationFeedbackStatus as a TypeScript enum
export enum VariationFeedbackStatus {
    PendingFeedback = 'Pending Feedback',
    NeedsChanges = 'Needs Changes',
    Approved = 'Approved',
    Rejected = 'Rejected'
}

export type Variation = {
    id: string;
    version_id: string;
    variation_letter: string; // e.g., 'A', 'B'
    notes: string | null;
    file_path: string | null; // Added file_path
    thumbnail_path?: string | null; // Added optional thumbnail path
    preview_path?: string | null;   // Added optional preview path
    status: VariationFeedbackStatus;
    created_at: string;
    updated_at?: string; // Optional
};

// Type for inserting a new variation 
export type NewVariationData = {
    version_id: string;
    variation_letter: string;
    notes: string | null;
    status: VariationFeedbackStatus;
    // file_path will be added after upload
};

// --- Comment Type ---
export type Comment = {
    id: string; // uuid
    variation_id: string; // uuid
    user_id: string; // uuid from auth.users
    content: string; // text
    parent_comment_id: string | null; // uuid, for threading
    x_coordinate: number | null; // real
    y_coordinate: number | null; // real
    created_at: string; // timestamptz
    updated_at: string; // timestamptz
    // Optional: Fetch profile details using the user_id
    profiles?: { display_name?: string; avatar_url?: string; } | null;
};

// --- Upload Types ---
// Type for file info in upload queues
export interface UploadingFileInfo {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';
  progress: number;
  error?: string;
  xhr?: XMLHttpRequest;
  uploadStarted?: boolean; // Used on Project Page Upload
  // Add other relevant fields, e.g., for UploadThing:
  uploadKey?: string; // From UploadThing
  uploadUrl?: string; // From UploadThing
}

// --- Combined Types for Data Fetching ---

// A Variation, including its comments
export type VariationDetail = Variation & {
    comments: Comment[];
};

// A Version, including its variations (which now include comments)
export type VersionWithVariations = Version & {
    variations: VariationDetail[];
};

// The full Design details needed for the modal
export type DesignDetailsData = Design & {
    versions: VersionWithVariations[];
};

// Combined type used on Design Detail page query (kept for potential separate page use)
export type DesignWithVersions = Design & { versions: Version[] };

// Used on Version Detail page query (kept for potential separate page use)
export type VersionWithDetails = Version & {
    variations: Variation[];
    design?: Design; // Include parent design info
    project?: Project; // Include parent project info
};

// --- NEW: Type for data returned by get_designs_with_latest_thumbnail RPC ---
export type DesignGridItem = Pick<
    Design, 
    'id' | 'project_id' | 'name' | 'status' | 'created_at' | 'updated_at' | 'created_by'
> & {
    latest_version_stage: DesignStage | null;
    latest_thumbnail_path: string | null;
}; 