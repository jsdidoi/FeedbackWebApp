// supabase/functions/image-processor/imageConstants.ts
// Duplicated constants for use within the edge function

export const SUPPORTED_IMAGE_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'gif'];

export const DEFAULT_IMAGE_QUALITY = 75;

export const THUMBNAIL_WIDTH = 200;
export const MEDIUM_WIDTH = 800;
export const LARGE_WIDTH = 1200;

// Path for uploads within the *triggering* bucket (used for filtering)
// This should match the constant in webapp/lib
export const RAW_UPLOADS_PATH = 'uploads'; 

// Note: PROCESSED_IMAGES_PATH is not needed here as the target path
// is determined relative to the target bucket. 