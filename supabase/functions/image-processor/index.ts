/// <reference types="https://deno.land/x/deno/cli/types/snapshot.d.ts" />
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
// Import wasm-image-decoder - NOTE .js extension and specific version
import decode from 'https://deno.land/x/wasm_image_decoder@v0.0.7/mod.js'; 
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  DEFAULT_IMAGE_QUALITY,
  LARGE_WIDTH,
  MEDIUM_WIDTH,
//   PROCESSED_IMAGES_PATH, // No longer needed for path generation here
  RAW_UPLOADS_PATH,
  SUPPORTED_IMAGE_FORMATS,
  THUMBNAIL_WIDTH,
} from './imageConstants.ts'; // Import from local file

// --- DIAGNOSTIC LOG --- 
console.log('Imported imageMod:', imageMod);
console.log('Type of imageMod:', typeof imageMod);
// --- END DIAGNOSTIC LOG ---

console.log('Image Processor function booting up (using wasm-image-decoder)...');

// Define the structure of the webhook payload from Supabase Storage
interface StorageObject {
  id: string;
  name: string; // This is the full path within the bucket (e.g., 'public/avatar1.jpg')
  bucket_id: string;
  // Add other relevant fields if needed
}

interface StorageWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: StorageObject | null;
  old_record: StorageObject | null;
}

// Helper function to create Supabase client with service role key
function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// --- Image Processing Logic (using wasm-image-decoder for decode test) ---
async function processImage(supabaseAdmin: SupabaseClient, bucketName: string, objectPath: string) {
    console.log(`Processing image: ${bucketName}/${objectPath}`);

    const fileExt = objectPath.split('.').pop()?.toLowerCase();
    if (!fileExt || !SUPPORTED_IMAGE_FORMATS.includes(fileExt)) {
        console.warn(`Unsupported file type: ${fileExt}. Skipping.`);
        return;
    }

    // 1. Download the original image
    const { data: blob, error: downloadError } = await supabaseAdmin.storage
        .from(bucketName)
        .download(objectPath);

    if (downloadError || !blob) {
        console.error(`Error downloading ${objectPath}:`, downloadError);
        return;
    }
    console.log(`Downloaded ${objectPath}, size: ${blob.size} bytes, type: ${blob.type}`);
    const originalBuffer = await blob.arrayBuffer();
    const originalMimeType = blob.type; // Store original mime type

    // --- Test wasm-image-decoder --- 
    try {
        console.log(`Attempting to decode ${objectPath} using wasm-image-decoder...`);
        const decodedResult = await decode(originalBuffer); // Use wasm decoder
        console.log(`Successfully decoded ${objectPath}. Dimensions: ${decodedResult.width}x${decodedResult.height}`);
        // decodedResult contains { width, height, data: Uint8Array } but we won't use them yet
    } catch (decodeError) {
        console.error(`Error decoding ${objectPath} using wasm-image-decoder:`, decodeError);
        return; // Stop if decoding fails
    }
    // --- End decode test ---

    // 2. Loop through target widths and upload ORIGINAL buffer to target paths
    const widthsToProcess = [THUMBNAIL_WIDTH, MEDIUM_WIDTH, LARGE_WIDTH];
    const targetBucket = Deno.env.get('PROCESSED_IMAGES_BUCKET_NAME') || bucketName;
    console.log(`Target bucket for processed images: ${targetBucket}`);

    for (const width of widthsToProcess) {
        try {
            // Generate the target path with .webp extension (even though content isn't webp)
            const processedPath = generateProcessedPath(objectPath, width);
            
            console.log(`Uploading ORIGINAL buffer (${(originalBuffer.byteLength / 1024).toFixed(2)} KB, ${originalMimeType}) to ${processedPath}...`);

            // Upload the ORIGINAL buffer with its ORIGINAL mime type
            const { error: uploadError } = await supabaseAdmin.storage
                .from(targetBucket)
                .upload(processedPath, originalBuffer, { // <-- Upload originalBuffer
                    contentType: originalMimeType, // <-- Use originalMimeType
                    cacheControl: '3600', 
                    upsert: true 
                });

            if (uploadError) {
                console.error(`Error uploading original buffer to ${processedPath}:`, uploadError);
                // Optionally stop here if one upload fails
                // return;
            } else {
                 console.log(`Successfully uploaded original buffer to ${processedPath}`);
            }

        } catch (uploadLoopError) {
            // Catch errors specific to this loop iteration (e.g., path generation?) 
            console.error(`Error during upload loop for width ${width}:`, uploadLoopError);
            // Optionally stop processing other sizes 
            // return;
        }
    }

     console.log(`Finished processing (uploading originals) for ${objectPath}`);
}

// Generates the path for the processed image, relative to the target bucket root
// Corrected logic to handle potential existing _WIDTH suffixes and extensions.
function generateProcessedPath(originalPath: string, targetWidth: number): string {
    const parts = originalPath.split('/');
    const fileNameWithAnyExt = parts.pop() || '';
    
    // 1. Remove any existing extension (e.g., .png, .gif, .webp)
    const fileNameWithoutAnyExt = fileNameWithAnyExt.split('.').slice(0, -1).join('.');
    
    // 2. Remove any existing _WIDTH suffix (e.g., _200, _800, _1200) using regex
    // This looks for an underscore followed by digits at the end of the string
    const baseFileName = fileNameWithoutAnyExt.replace(/_\d+$/, ''); 
    
    const originalSubPath = parts.join('/');

    // 3. Construct the new path using the clean base name and target width
    const relativePath = originalSubPath 
        ? `${originalSubPath}/${baseFileName}_${targetWidth}.webp` 
        : `${baseFileName}_${targetWidth}.webp`;
        
    console.log(`[generateProcessedPath] Input: ${originalPath}, BaseName: ${baseFileName}, Output: ${relativePath}`); // Added logging
    return relativePath;
}


// --- Server Handler (Uncomment processImage call) ---
serve(async (req: Request) => {
  console.log('Received request on /image-processor');

  // 1. Check method and headers
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  // Optional: Add security, like checking a secret webhook signature

  // 2. Parse payload
  let payload: StorageWebhookPayload;
  try {
    payload = await req.json();
    console.log('Webhook payload received:', JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('Error parsing JSON payload:', e);
    return new Response('Bad Request: Invalid JSON', { status: 400 });
  }

  // 3. Validate payload structure (basic check)
  if (
    payload.type !== 'INSERT' ||
    payload.schema !== 'storage' ||
    payload.table !== 'objects' ||
    !payload.record ||
    !payload.record.name ||
    !payload.record.bucket_id
  ) {
    console.warn('Ignoring webhook: Not an object insertion or invalid format.');
    return new Response('Ignoring irrelevant webhook', { status: 200 });
  }

  // 4. Check bucket and path
  const objectName = payload.record.name;
  const bucketName = payload.record.bucket_id;
  const RAW_UPLOADS_BUCKET_NAME = 'design-variations';

  if (bucketName !== RAW_UPLOADS_BUCKET_NAME) {
      console.log(`Ignoring event from non-source bucket: ${bucketName}`);
      return new Response('Ignoring event from non-source bucket.', { status: 200 });
  }

  // 5. Trigger processing 
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    // --- Restore processImage call ---
    console.log('[Handler] Triggering processImage...');
    processImage(supabaseAdmin, bucketName, objectName)
        .catch(err => console.error(`Unhandled error during processImage for ${objectName}:`, err));
    // --- End Restore ---
  } catch (clientError) {
      console.error('Failed to get Supabase admin client:', clientError);
      return new Response('Internal Server Error: Could not initialize client', { status: 500 });
  }

  // 6. Respond quickly
  console.log(`Webhook processed for ${objectName}, processing initiated.`); // Restore original log
  return new Response(JSON.stringify({ message: 'Processing initiated' }), { // Restore original log
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
});

/*
Setup Instructions:
1.  Ensure Deno is installed.
2.  Install Supabase CLI: `npm install supabase --save-dev` (if not already)
3.  Login: `npx supabase login`
4.  Link project: `npx supabase link --project-ref <your-project-ref>`
5.  Set required secrets for the function:
    `npx supabase secrets set SUPABASE_URL=<your-project-url>`
    `npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>`
    `npx supabase secrets set PROCESSED_IMAGES_BUCKET_NAME=<your-target-public-bucket-name>`
    // Optional: If using separate raw bucket trigger:
    // `npx supabase secrets set RAW_UPLOADS_BUCKET_NAME=<your-raw-uploads-bucket-name>`
6.  Deploy: `npx supabase functions deploy image-processor --no-verify-jwt`
7.  Configure Storage Bucket(s):
    - Ensure the bucket referenced by `PROCESSED_IMAGES_BUCKET_NAME` exists and is PUBLIC.
    - Ensure the bucket/path triggering the webhook exists (e.g., a bucket named 'design-variations' or 'raw-uploads').
8.  Set up a Storage Webhook:
    - Go to Database -> Webhooks in Supabase dashboard.
    - Enable Webhooks if needed.
    - Create a new webhook:
        - Name: Image Upload Processor
        - Table: `storage.objects`
        - Events: `INSERT`
        - Triggered on Bucket(s): Select the specific bucket(s) containing your raw uploads (e.g., 'design-variations' or 'raw-uploads').
        - HTTP Request:
            - Method: POST
            - URL: `<your-function-url>` (Find this in Functions section after deploy)
            - Headers: (Optional) Add authentication if needed.
    - Create webhook.
9.  (IMPORTANT) Add an image processing library compatible with Deno (like `deno-image`) to this function. Replace the placeholder code inside `processImage`.
10. Review and adjust the `isRawUpload` logic in the handler based on your bucket structure (Scenario 1 vs Scenario 2 in comments).
11. Ensure the `RAW_UPLOADS_BUCKET_NAME` constant inside the function matches the bucket where originals are uploaded.
12. Path prefix check removed, relying on bucket check.
13. Added `deno-image` library (latest) for resizing and conversion.
*/ 