import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
// Note: You might need to adjust the import based on the actual library and version
// import * as imageMod from 'https://deno.land/x/image@v1.0.0/mod.ts'; // Example import for deno-image
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  DEFAULT_IMAGE_QUALITY,
  LARGE_WIDTH,
  MEDIUM_WIDTH,
  PROCESSED_IMAGES_PATH,
  RAW_UPLOADS_PATH,
  SUPPORTED_IMAGE_FORMATS,
  THUMBNAIL_WIDTH,
} from '../../../lib/constants/imageConstants.js'; // Adjust path as needed


console.log('Image Processor function booting up...');

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

// --- Image Processing Logic ---
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
    console.log(`Downloaded ${objectPath}, size: ${blob.size} bytes`);
    const originalBuffer = await blob.arrayBuffer();

    // 2. Process for different sizes (using a hypothetical image library)
    const widthsToProcess = [THUMBNAIL_WIDTH, MEDIUM_WIDTH, LARGE_WIDTH];
    const uploadPromises = [];

    for (const width of widthsToProcess) {
        try {
            console.log(`Resizing ${objectPath} to width ${width}...`);
            // --- Replace with actual image processing library calls ---
            // Example using a hypothetical `imageMod` like deno-image:
            // const image = await imageMod.decode(originalBuffer);
            // image.resize(width, imageMod.RESIZE_AUTO);
            // const processedBuffer = await image.encode('webp', { quality: DEFAULT_IMAGE_QUALITY });
            // --- End Placeholder ---

            // Placeholder: Simulate processing buffer
            const processedBuffer = originalBuffer; // Remove this line when using a real library
            const processedMimeType = 'image/webp'; // Assuming conversion to webp

            if (processedBuffer) { // Check if processing was successful
                const newPath = generateProcessedPath(objectPath, width);
                console.log(`Uploading processed image to: ${bucketName}/${newPath}`);

                uploadPromises.push(
                    supabaseAdmin.storage
                        .from(bucketName) // Assuming processed images in the same bucket, different path
                        .upload(newPath, processedBuffer, {
                            contentType: processedMimeType,
                            upsert: true, // Overwrite if exists
                            cacheControl: '3600', // Cache for 1 hour
                        })
                );
            } else {
                 console.warn(`Processing failed for ${objectPath} at width ${width}`);
            }

        } catch (processingError) {
            console.error(`Error processing ${objectPath} for width ${width}:`, processingError);
        }
    }

    // 3. Wait for all uploads to finish
    const results = await Promise.allSettled(uploadPromises);
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            if(result.value.error) {
                 console.error(`Error uploading processed image for width ${widthsToProcess[index]}:`, result.value.error);
            } else {
                 console.log(`Successfully uploaded processed image for width ${widthsToProcess[index]}`);
            }
        } else {
            console.error(`Upload promise rejected for width ${widthsToProcess[index]}:`, result.reason);
        }
    });

     console.log(`Finished processing for ${objectPath}`);
}

// Generates the path for the processed image
// e.g., 'uploads/user1/avatar.png' -> 'uploads/user1/avatar_200.webp' (relative to bucket root)
function generateProcessedPath(originalPath: string, width: number): string {
    const parts = originalPath.split('/');
    const fileNameWithExt = parts.pop() || '';
    const fileName = fileNameWithExt.split('.').slice(0, -1).join('.'); // Handle names with dots
    const originalSubPath = parts.join('/'); // Path relative to the RAW_UPLOADS_PATH

    // Construct path relative to the target bucket root.
    // Example: 'user1/avatar.png' (as originalSubPath) -> 'user1/avatar_200.webp'
    // Example: 'test.jpg' (as originalSubPath='') -> 'test_200.webp'
    const relativePath = originalSubPath ? `${originalSubPath}/${fileName}_${width}.webp` : `${fileName}_${width}.webp`;
    return relativePath;
}


// --- Server Handler ---
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

  // 4. Check if the upload is in the target path (e.g., starts with RAW_UPLOADS_PATH)
  const objectName = payload.record.name;
  const bucketName = payload.record.bucket_id;

  // IMPORTANT: Adjust this check based on your bucket structure.
  // If your bucket is named 'uploads', objectName might be 'user1/avatar.jpg'.
  // If your bucket contains the 'uploads' folder, objectName might be 'uploads/user1/avatar.jpg'.
  // This example assumes the bucket name itself implies the upload area,
  // or that the objectName starts with the raw path constant.
  const isRawUpload = objectName.startsWith(RAW_UPLOADS_PATH + '/'); // Check if it's in the raw directory

  // OR, if your dedicated bucket is named like RAW_UPLOADS_PATH:
  // const isRawUpload = bucketName === RAW_UPLOADS_PATH;

  if (!isRawUpload) {
      console.log(`Ignoring file outside raw uploads path: ${bucketName}/${objectName}`);
      return new Response('File is not a raw upload, ignoring.', { status: 200 });
  }

  // 5. Trigger processing (don't await this, let it run in background)
  const supabaseAdmin = getSupabaseAdminClient();
  processImage(supabaseAdmin, bucketName, objectName)
      .catch(err => console.error(`Unhandled error during processImage for ${objectName}:`, err));

  // 6. Respond quickly to Supabase
  console.log(`Webhook processed for ${objectName}, processing initiated.`);
  return new Response(JSON.stringify({ message: 'Processing initiated' }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
});

/*
Setup Instructions:
1.  Ensure Deno is installed.
2.  Install Supabase CLI: `npm install supabase --save-dev`
3.  Login: `npx supabase login`
4.  Link project: `npx supabase link --project-ref <your-project-ref>`
5.  Set secrets:
    `npx supabase secrets set SUPABASE_URL=<your-project-url>`
    `npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>`
6.  Deploy: `npx supabase functions deploy image-processor --no-verify-jwt`
7.  Create Supabase Storage buckets (e.g., 'uploads' or adjust constants). Make the target bucket for processed images public if needed.
8.  Set up a Storage Webhook:
    - Go to Database -> Webhooks in your Supabase dashboard.
    - Click "Enable Webhooks".
    - Click "Create a new webhook".
    - Name: `Image Upload Processor`
    - Table: `storage.objects`
    - Events: `INSERT`
    - HTTP Request:
        - Method: POST
        - URL: `<your-function-url>` (Find this in Functions section after deploy)
        - Headers: (Optional) Add authentication if needed.
    - Click "Create webhook".
9.  (IMPORTANT) Add an image processing library compatible with Deno (like `deno-image`) to this function's environment or import map. The placeholder code needs to be replaced.
10. Adjust `RAW_UPLOADS_PATH` and the logic in `isRawUpload` check based on your actual bucket and folder structure.
*/ 