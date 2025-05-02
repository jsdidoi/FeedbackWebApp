/// <reference types="https://deno.land/x/deno/cli/types/snapshot.d.ts" />
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

console.log('Storage Cleanup function booting up...');

// Define bucket names (consider making these env vars later)
const DESIGN_VARIATIONS_BUCKET = 'design-variations';
const PROCESSED_IMAGES_BUCKET = 'processed-images';
// Add other buckets if needed (e.g., comment-attachments)
// const COMMENT_ATTACHMENTS_BUCKET = 'comment-attachments'; 

// Define the structure of the webhook payload for DELETE events
// Note: For DELETE, we look at the 'old_record'
interface RecordData {
  id: string;
  project_id?: string; // Needed when deleting a design
  // Add other fields if necessary for path construction
}

interface StorageWebhookPayload {
  type: 'DELETE';
  table: 'designs' | 'projects'; // Only handle these tables
  schema: string;
  old_record: RecordData | null;
}

// Helper function to create Supabase admin client
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

// --- Main Handler ---
serve(async (req: Request) => {
  console.log('Received request on /storage-cleanup');

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let payload: StorageWebhookPayload;
  try {
    payload = await req.json();
    console.log('[Cleanup] Webhook payload received:', JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('[Cleanup] Error parsing JSON payload:', e);
    return new Response('Bad Request: Invalid JSON', { status: 400 });
  }

  // 1. Validate payload type and table
  if (payload.type !== 'DELETE' || !payload.old_record || (payload.table !== 'designs' && payload.table !== 'projects')) {
    console.log(`[Cleanup] Ignoring irrelevant webhook: Type ${payload.type}, Table ${payload.table}`);
    return new Response('Ignoring irrelevant webhook event', { status: 200 });
  }

  const deletedRecord = payload.old_record;
  let pathPrefix = '';

  // 2. Determine the path prefix based on the deleted table
  if (payload.table === 'projects' && deletedRecord.id) {
    pathPrefix = `projects/${deletedRecord.id}/`;
    console.log(`[Cleanup] Determined path prefix for deleted project ${deletedRecord.id}: ${pathPrefix}`);
  } else if (payload.table === 'designs' && deletedRecord.id && deletedRecord.project_id) {
    pathPrefix = `projects/${deletedRecord.project_id}/designs/${deletedRecord.id}/`;
    console.log(`[Cleanup] Determined path prefix for deleted design ${deletedRecord.id}: ${pathPrefix}`);
  } else {
    console.warn(`[Cleanup] Could not determine path prefix for table ${payload.table} and record ID ${deletedRecord.id}`);
    return new Response('Could not determine path prefix', { status: 400 }); // Bad request if essential info missing
  }

  // 3. Attempt to delete files from storage for the determined prefix
  if (pathPrefix) {
    try {
      const supabaseAdmin = getSupabaseAdminClient();
      const bucketsToDeleteFrom = [DESIGN_VARIATIONS_BUCKET, PROCESSED_IMAGES_BUCKET]; // Add other buckets here if needed

      for (const bucketName of bucketsToDeleteFrom) {
          console.log(`[Cleanup] Listing files in bucket '${bucketName}' with prefix '${pathPrefix}'...`);
          
          // List all files within the prefix directory
          const { data: files, error: listError } = await supabaseAdmin.storage
              .from(bucketName)
              .list(pathPrefix, {
                  limit: 1000, // Adjust limit if needed, consider pagination for very large folders
                  // offset: 0, 
                  // sortBy: { column: 'name', order: 'asc' },
              });

          if (listError) {
              console.error(`[Cleanup] Error listing files in ${bucketName} with prefix ${pathPrefix}:`, listError);
              // Continue to next bucket or bail? Let's continue for now.
              continue; 
          }

          if (files && files.length > 0) {
              // Construct the full paths for removal
              const pathsToRemove = files.map(file => `${pathPrefix}${file.name}`);
              console.log(`[Cleanup] Found ${pathsToRemove.length} file(s) to remove from ${bucketName}:`, pathsToRemove);

              // Remove the files
              const { error: removeError } = await supabaseAdmin.storage
                  .from(bucketName)
                  .remove(pathsToRemove);

              if (removeError) {
                  console.error(`[Cleanup] Error removing files from ${bucketName} with prefix ${pathPrefix}:`, removeError);
                  // Log error but don't necessarily fail the whole function response
              } else {
                  console.log(`[Cleanup] Successfully removed ${pathsToRemove.length} file(s) from ${bucketName} for prefix ${pathPrefix}`);
              }
          } else {
              console.log(`[Cleanup] No files found in ${bucketName} with prefix ${pathPrefix} to remove.`);
          }
      }
       console.log(`[Cleanup] Finished storage cleanup attempt for prefix ${pathPrefix}`);

    } catch (error) {
        console.error(`[Cleanup] Unexpected error during storage cleanup for prefix ${pathPrefix}:`, error);
        // Return 500 for unexpected errors during processing
        return new Response('Internal Server Error during cleanup', { status: 500 });
    }
  }

  // Respond 200 OK even if storage cleanup had issues, as DB delete was the trigger
  console.log('[Cleanup] Webhook processed successfully.');
  return new Response(JSON.stringify({ message: 'Cleanup initiated/processed' }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
});

/*
Setup Instructions:
1. Ensure Deno is installed.
2. Install Supabase CLI: `npm install supabase --save-dev` (if not already)
3. Login: `npx supabase login`
4. Link project: `npx supabase link --project-ref <your-project-ref>`
5. Set required secrets for the function:
   `npx supabase secrets set SUPABASE_URL=<your-project-url>`
   `npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>`
6. Deploy: `npx supabase functions deploy storage-cleanup --no-verify-jwt`
7. Set up Database Webhooks (AFTER successful deploy):
   - Go to Database -> Webhooks in Supabase dashboard. Enable if needed.
   - Create Webhook 1:
     - Name: Design Delete Cleanup
     - Table: `designs` (public schema)
     - Events: `DELETE`
     - Trigger: Function
     - Function Name: `storage-cleanup`
     - (Optional) Add Authorization header if needed
     - Create webhook.
   - Create Webhook 2:
     - Name: Project Delete Cleanup
     - Table: `projects` (public schema)
     - Events: `DELETE`
     - Trigger: Function
     - Function Name: `storage-cleanup`
     - (Optional) Add Authorization header if needed
     - Create webhook.
*/ 