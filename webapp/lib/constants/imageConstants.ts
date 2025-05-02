// webapp/lib/constants/imageConstants.ts

export const SUPPORTED_IMAGE_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'gif'];

export const DEFAULT_IMAGE_QUALITY = 75;

export const THUMBNAIL_WIDTH = 200;
export const MEDIUM_WIDTH = 800;
export const LARGE_WIDTH = 1200;

// Example storage paths (adjust based on your Supabase setup)
export const RAW_UPLOADS_PATH = 'uploads';
export const PROCESSED_IMAGES_PATH = 'processed/images';

export const IMAGE_PROCESSING_FUNCTION_NAME = 'image-processor'; 