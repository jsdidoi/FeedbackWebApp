import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

console.log('Trigger Process Image function booting up...');

// Define the structure of the expected webhook payload
interface StorageObject {
  name: string; // Full path within the bucket
  // Add other fields if needed for validation
}

interface StorageWebhookPayload {
  type: 'INSERT';
  table: 'objects';
  schema: 'storage';
  record: StorageObject | null;
}

// Get the target Next.js API endpoint URL from secrets/env vars
// IMPORTANT: Set this secret in your Supabase project!
// Example value: https://your-nextjs-app.vercel.app/api/process-image
// Or for local testing: http://host.docker.internal:3000/api/process-image
// (Using host.docker.internal allows the function container to reach your local machine)
const NEXTJS_API_ENDPOINT = Deno.env.get('NEXTJS_PROCESS_IMAGE_URL');

if (!NEXTJS_API_ENDPOINT) {
    console.error('CRITICAL ERROR: NEXTJS_PROCESS_IMAGE_URL environment variable is not set!');
    // Optionally, throw an error to prevent the function from starting?
    // throw new Error('Missing NEXTJS_PROCESS_IMAGE_URL');
}

serve(async (req: Request) => {
    // 1. Basic Check (Method, Content-Type - optional but good practice)
    if (req.method !== 'POST') {
        console.warn('Received non-POST request');
        return new Response('Method Not Allowed', { status: 405 });
    }

    // 2. Parse Payload
    let payload: StorageWebhookPayload;
    try {
        payload = await req.json();
        console.log('Received webhook payload:', JSON.stringify(payload, null, 2));
    } catch (e) {
        console.error('Error parsing JSON payload:', e);
        return new Response('Bad Request: Invalid JSON', { status: 400 });
    }

    // 3. Validate Payload
    if (
        payload.type !== 'INSERT' ||
        !payload.record ||
        !payload.record.name
    ) {
        console.warn('Ignoring webhook: Not a valid INSERT event with record name.');
        return new Response('Ignoring irrelevant webhook event', { status: 200 });
    }

    const originalPath = payload.record.name;

    // 4. Trigger the Next.js API Route (DO NOT await)
    if (NEXTJS_API_ENDPOINT) {
        console.log(`Forwarding request for ${originalPath} to ${NEXTJS_API_ENDPOINT}`);
        fetch(NEXTJS_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Add any necessary auth headers if your API route is protected
                // 'Authorization': `Bearer ${SOME_SECRET_TOKEN}`
            },
            body: JSON.stringify({ originalPath: originalPath }),
        })
        .then(async (res) => {
            // Log the response from the Next.js API, but don't block the function
            const status = res.status;
            const text = await res.text(); // Read body as text to handle JSON/non-JSON
            console.log(`Next.js API response for ${originalPath}: Status ${status}, Body: ${text}`);
        })
        .catch(err => {
            // Log errors from the fetch call itself
            console.error(`Error fetching Next.js API endpoint for ${originalPath}:`, err);
        });
    } else {
        console.error('Cannot forward request: NEXTJS_PROCESS_IMAGE_URL is not set.');
        // Decide if this should be a server error back to the webhook source?
        // For now, just log it and respond 200 to Supabase.
    }

    // 5. Respond quickly to the original Supabase webhook
    console.log(`Webhook acknowledged for ${originalPath}, forwarding initiated.`);
    return new Response(JSON.stringify({ message: 'Webhook received, forwarding initiated.' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 202, // 202 Accepted is appropriate here
    });
}); 