import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import {
    THUMBNAIL_WIDTH,
    MEDIUM_WIDTH,
    LARGE_WIDTH,
    DEFAULT_IMAGE_QUALITY,
    SUPPORTED_IMAGE_FORMATS
} from '@/lib/constants/imageConstants'; // Adjust path as needed

// Ensure these environment variables are set in your Next.js environment
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// IMPORTANT: Use the SERVICE ROLE KEY here, not the ANON KEY
// Store this securely, e.g., in Vercel Environment Variables, not in .env.local for client-side code
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const defaultSourceBucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'design-variations'; 
const commentAttachmentBucket = 'comment-attachments'; // Specific bucket for comments
const targetBucket = process.env.NEXT_PUBLIC_SUPABASE_PROCESSED_BUCKET || 'processed-images';

// --- Helper function to generate processed path (similar to edge function) ---
function generateProcessedPath(originalPath: string, targetWidth: number, isGif: boolean = false): string {
    const parts = originalPath.split('/');
    const fileNameWithAnyExt = parts.pop() || '';
    const fileNameWithoutAnyExt = fileNameWithAnyExt.split('.').slice(0, -1).join('.');
    const baseFileName = fileNameWithoutAnyExt.replace(/_\d+$/, '');
    const originalSubPath = parts.join('/');
    
    if (isGif) {
        // For GIFs, we keep the original extension and don't append width,
        // as we're just copying it. The path might still be useful for structure.
        // We'll use a simple _gif suffix to differentiate if needed, or just the base name.
        const gifFileName = `${baseFileName}.gif`;
        return originalSubPath
            ? `${originalSubPath}/${gifFileName}`
            : gifFileName;
    }

    const relativePath = originalSubPath
        ? `${originalSubPath}/${baseFileName}_${targetWidth}.webp`
        : `${baseFileName}_${targetWidth}.webp`;
    return relativePath;
}

// Initialize Supabase client ONCE with the service role key
// Ensure this only runs server-side (which API routes do)
const supabaseAdmin = createClient(
    supabaseUrl || '',
    supabaseServiceKey || '',
    {
        auth: {
            // Avoid storing user sessions on the server
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    }
);

export async function POST(request: NextRequest) {
    console.log('[API /process-image] Received POST request');

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('[API /process-image] Missing Supabase URL or Service Key environment variables.');
        return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    let originalPath: string;
    try {
        const body = await request.json();
        originalPath = body.originalPath;
        if (!originalPath) {
            throw new Error('Missing originalPath in request body');
        }
        console.log(`[API /process-image] Processing request for: ${originalPath}`);
    } catch (error: unknown) {
        console.error('[API /process-image] Error parsing request body:', error);
        return NextResponse.json({ error: 'Invalid request body.', details: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }

    const fileExt = originalPath.split('.').pop()?.toLowerCase();
    if (!fileExt || !SUPPORTED_IMAGE_FORMATS.includes(fileExt)) {
        console.warn(`[API /process-image] Unsupported file type: ${fileExt}. Skipping.`);
        // Return success even if skipped, as the trigger shouldn't retry
        return NextResponse.json({ message: 'Unsupported file type, skipped.' }, { status: 200 });
    }

    const isOriginalGif = fileExt === 'gif';

    // --- Determine the correct source bucket based on the originalPath ---
    let actualSourceBucket = defaultSourceBucket;
    if (originalPath.startsWith('comments/')) {
        actualSourceBucket = commentAttachmentBucket;
    }
    console.log(`[API /process-image] Determined source bucket: ${actualSourceBucket} for path: ${originalPath}`);
    // --- End Determine Source Bucket ---

    try {
        // --- 1. Download Original Image --- 
        console.log(`[API /process-image] Downloading original from ${actualSourceBucket}/${originalPath}...`);
        const { data: blob, error: downloadError } = await supabaseAdmin.storage
            .from(actualSourceBucket) // Use the dynamically determined source bucket
            .download(originalPath);

        if (downloadError || !blob) {
            console.error(`[API /process-image] Error downloading ${originalPath}:`, downloadError);
            throw new Error(`Failed to download original file: ${downloadError?.message || 'Unknown error'}`);
        }
        const originalBuffer = Buffer.from(await blob.arrayBuffer());
        console.log(`[API /process-image] Downloaded ${originalPath}, size: ${originalBuffer.length} bytes`);

        if (isOriginalGif) {
            // --- Handle GIF: Copy to target bucket using the ORIGINAL path ---
            console.log(`[API /process-image] GIF detected. Copying ${originalPath} to ${targetBucket}/${originalPath}`);

            const { error: copyError } = await supabaseAdmin.storage
                .from(targetBucket)
                .upload(originalPath, originalBuffer, {
                    contentType: 'image/gif', // Set correct content type for GIF
                    cacheControl: '3600',
                    upsert: true, // Or false if you don't want to overwrite
                });

            if (copyError) {
                console.error(`[API /process-image] Error copying GIF ${originalPath} to ${targetBucket}:`, copyError);
                throw new Error(`Failed to copy GIF: ${copyError.message}`);
            }

            console.log(`[API /process-image] Successfully copied GIF to ${targetBucket}/${originalPath}`);
            return NextResponse.json({ message: 'GIF processed (copied) successfully.' }, { status: 200 });

        } else {
            // --- Handle Other Image Types: Process and Upload Different Sizes --- 
            const widthsToProcess = [THUMBNAIL_WIDTH, MEDIUM_WIDTH, LARGE_WIDTH];
            const processingPromises = [];

            for (const width of widthsToProcess) {
                const processedPath = generateProcessedPath(originalPath, width);
                console.log(`[API /process-image] Processing for width ${width}, target path: ${processedPath}`);

                // Use sharp to resize and convert to WebP
                const processedBuffer = await sharp(originalBuffer)
                    .resize({ width: width, withoutEnlargement: true }) // Don't upscale smaller images
                    .webp({ quality: DEFAULT_IMAGE_QUALITY })
                    .toBuffer();

                console.log(`[API /process-image] Uploading ${processedPath} (${processedBuffer.length} bytes) to ${targetBucket}...`);
                
                // Create a promise for each upload
                processingPromises.push(
                    supabaseAdmin.storage
                        .from(targetBucket)
                        .upload(processedPath, processedBuffer, {
                            contentType: 'image/webp',
                            cacheControl: '3600',
                            upsert: true,
                        })
                );
            }

            // --- 3. Wait for all uploads --- 
            const results = await Promise.allSettled(processingPromises);

            let uploadErrors = 0;
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    uploadErrors++;
                    console.error(`[API /process-image] Error uploading processed image for width ${widthsToProcess[index]}:`, result.reason);
                } else if (result.value.error) {
                    // Supabase client might return an error object even if promise resolves
                    uploadErrors++;
                    console.error(`[API /process-image] Supabase upload error for width ${widthsToProcess[index]}:`, result.value.error);
                } else {
                     // --- ADDED LOG FOR EXACT STORED PATH ---
                     const processedPath = generateProcessedPath(originalPath, widthsToProcess[index]); // Re-generate to log the correct path for this iteration
                     console.log(`[API /process-image] SUCCESSFULLY STORED AS: ${processedPath}`);
                     console.log(`[API /process-image] Successfully uploaded width ${widthsToProcess[index]}`);
                }
            });

            if (uploadErrors > 0) {
                console.warn(`[API /process-image] Finished processing for ${originalPath} with ${uploadErrors} upload error(s).`);
                 // Still return success, but maybe log differently or handle partial failure
                 return NextResponse.json({ message: `Processing finished with ${uploadErrors} error(s).` }, { status: 207 }); // Multi-Status
            } else {
                 console.log(`[API /process-image] Successfully processed and uploaded all sizes for ${originalPath}`);
                 return NextResponse.json({ message: 'Image processed successfully.' }, { status: 200 });
            }
        }

    } catch (error: unknown) {
        console.error(`[API /process-image] CRITICAL ERROR processing ${originalPath}:`, error);
        return NextResponse.json({ error: 'Image processing failed.', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
}

// Optional: Add GET handler or other methods if needed
export async function GET(request: NextRequest) {
    return NextResponse.json({ message: 'Image processing endpoint. Use POST.' }, { status: 405 });
} 