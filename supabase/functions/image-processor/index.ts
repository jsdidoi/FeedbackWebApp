import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
// Note: You might need to adjust the import based on the actual library and version
// import * as imageMod from 'https://deno.land/x/image@v1.0.0/mod.ts'; // Example import for deno-image
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

    // Determine the target bucket for processed images
    // Uses env var, assumes it's different from the source/trigger bucket
    const targetBucket = Deno.env.get('PROCESSED_IMAGES_BUCKET_NAME') || bucketName;
    console.log(`Target bucket for processed images: ${targetBucket}`);

    for (const width of widthsToProcess) {
        try {
            console.log(`Resizing ${objectPath} to width ${width}...`);
            // --- Replace with actual image processing library calls ---
            // Example using a hypothetical `imageMod` like deno-image:
            // import * as imageMod from 'https://deno.land/x/image@v1.0.0/mod.ts';
            // const image = await imageMod.decode(originalBuffer);
            // image.resize(width, imageMod.RESIZE_AUTO); // Or image.resize(width, height) if fixed size
            // const processedBuffer = await image.encode('webp', { quality: DEFAULT_IMAGE_QUALITY });
            // --- End Placeholder ---

            // Placeholder: Simulate processing buffer (remove when using real library)
            const processedBuffer = originalBuffer;
            const processedMimeType = 'image/webp'; // Assuming conversion to webp

            if (processedBuffer) {
                // Use the corrected path generation
                const newPath = generateProcessedPath(objectPath, width);
                console.log(`Uploading processed image to: ${targetBucket}/${newPath}`);

                uploadPromises.push(
                    supabaseAdmin.storage
                        .from(targetBucket) // Upload to the designated processed bucket
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
                 console.error(`Upload error for width ${widthsToProcess[index]}:`, result.value.error);
            } else {
                 console.log(`Successfully uploaded processed image for width ${widthsToProcess[index]} to ${targetBucket}`);
            }
        } else {
            console.error(`Upload promise rejected for width ${widthsToProcess[index]}:`, result.reason);
        }
    });

     console.log(`Finished processing for ${objectPath}`);
}

// Generates the path for the processed image, relative to the target bucket root
// e.g., 'uploads/user1/avatar.png' -> 'uploads/user1/avatar_200.webp'
function generateProcessedPath(originalPath: string, width: number): string {
    const parts = originalPath.split('/');
    const fileNameWithExt = parts.pop() || '';
    const fileName = fileNameWithExt.split('.').slice(0, -1).join('.'); // Handle names with dots
    const originalSubPath = parts.join('/');

    // Construct path relative to the target bucket root.
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

  // 4. Check if the upload is in the target RAW path/bucket
  const objectName = payload.record.name;
  const bucketName = payload.record.bucket_id;

  // *** ADDED BUCKET ID CHECK ***
  // Define the expected source bucket name (where raw uploads happen)
  // IMPORTANT: Make sure this matches the bucket where your app uploads originals!
  const RAW_UPLOADS_BUCKET_NAME = 'design-variations'; // Or get from env secrets if configurable

  if (bucketName !== RAW_UPLOADS_BUCKET_NAME) {
      console.log(`Ignoring event from non-source bucket: ${bucketName}`);
      return new Response('Ignoring event from non-source bucket.', { status: 200 });
  }
  // *** END ADDED BUCKET ID CHECK ***

  // We are now relying solely on the RAW_UPLOADS_BUCKET_NAME check above
  // to ensure we only process files from the correct source bucket.
  // The check for a specific path prefix (like 'uploads/') has been removed
  // as the actual upload path seems to start with 'projects/'.

  // 5. Trigger processing (don't await this, let it run in background)
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    processImage(supabaseAdmin, bucketName, objectName)
        .catch(err => console.error(`Unhandled error during processImage for ${objectName}:`, err));
  } catch (clientError) {
      console.error('Failed to get Supabase admin client:', clientError);
      // Return 500 if we can't even start processing
      return new Response('Internal Server Error: Could not initialize client', { status: 500 });
  }

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
11. Ensure the `RAW_UPLOADS_BUCKET_NAME` constant inside the function matches the bucket where your application uploads original files.
12. Path prefix check (`startsWith(RAW_UPLOADS_PATH)`) was removed, relying on bucket name check instead.
*/ 