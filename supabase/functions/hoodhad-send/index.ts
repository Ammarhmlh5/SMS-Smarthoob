// hoodhad-send: proxy to HodHod platform API

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Subscriber = {
  email: string;
  name: string;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getUserToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.replace("Bearer ", "");
}

function userClient(token: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
}

function replacePlaceholders(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    return data[key] !== undefined ? data[key] : "";
  });
}

/**
 * Fetch subscribers from the HodHod platform API.
 * The user's gateway connection's api_key is the HodHod Bearer token.
 */
async function fetchHodHodSubscribers(
  apiKey: string,
  endpointUrl: string,
): Promise<Subscriber[]> {
  const url = new URL(endpointUrl);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HodHod API returned ${response.status}: ${text}`);
  }

  const data = await response.json();

  const subscribers: Subscriber[] = [];
  const items = Array.isArray(data) ? data : data.data ?? data.subscribers ?? [];

  for (const item of items) {
    const email = item.email ?? item.address ?? "";
    const name = item.name ?? item.subscriber_name ?? item.full_name ?? "";
    if (email) {
      subscribers.push({ email: String(email), name: String(name || "") });
    }
  }

  return subscribers;
}

/**
 * Send a single message through the gateway connection endpoint.
 * Builds the payload in the format expected by SMS gateways:
 * { sender_name, to, message }
 */
async function sendSingleMessage(
  endpointUrl: string,
  apiKey: string,
  senderName: string,
  to: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        sender: senderName,
        to: to,
        message: message,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

async function handleFetchSubscribers(req: Request, body: Record<string, unknown>) {
  const token = getUserToken(req)!;
  const client = userClient(token);

  const connectionId = body.connection_id;
  if (typeof connectionId !== "string") {
    return json({ error: "Connection ID is required" }, 400);
  }

  const { data: conn, error: connError } = await client
    .from("gateway_connections")
    .select("endpoint_url, api_key, sender_name")
    .eq("id", connectionId)
    .maybeSingle();

  if (connError || !conn) {
    return json({ error: "Connection not found" }, 404);
  }

  try {
    const subscribers = await fetchHodHodSubscribers(conn.api_key, conn.endpoint_url);
    return json({ subscribers });
  } catch (err) {
    return json({
      error: err instanceof Error ? err.message : "Failed to fetch subscribers",
      subscribers: [],
    }, 502);
  }
}

async function handleSendCampaign(req: Request, body: Record<string, unknown>) {
  const token = getUserToken(req)!;
  const client = userClient(token);

  const connectionId = body.connection_id;
  const templateId = body.template_id;
  const campaignName = body.campaign_name;
  const batchSize = typeof body.batch_size === "number" ? body.batch_size : 50;
  const maxRetries = typeof body.max_retries === "number" ? body.max_retries : 3;

  if (typeof connectionId !== "string" || typeof templateId !== "string") {
    return json({ error: "Connection ID and template ID are required" }, 400);
  }
  if (typeof campaignName !== "string" || campaignName.trim().length === 0) {
    return json({ error: "Campaign name is required" }, 400);
  }

  // Load connection and template (RLS ensures user ownership)
  const { data: conn, error: connError } = await client
    .from("gateway_connections")
    .select("endpoint_url, api_key, sender_name")
    .eq("id", connectionId)
    .maybeSingle();
  if (connError || !conn) return json({ error: "Connection not found" }, 404);

  const { data: tmpl, error: tmplError } = await client
    .from("message_templates")
    .select("body, title")
    .eq("id", templateId)
    .maybeSingle();
  if (tmplError || !tmpl) return json({ error: "Template not found" }, 404);

  // Fetch subscribers from HodHod
  let subscribers: Subscriber[];
  try {
    subscribers = await fetchHodHodSubscribers(conn.api_key, conn.endpoint_url);
  } catch (err) {
    return json({
      error: err instanceof Error ? err.message : "Failed to fetch subscribers",
    }, 502);
  }

  if (subscribers.length === 0) {
    return json({ error: "No subscribers found" }, 400);
  }

  // Create campaign
  const { data: campaign, error: campError } = await client
    .from("campaigns")
    .insert({
      name: campaignName.trim(),
      template_id: templateId,
      connection_id: connectionId,
      status: "sending",
      total_recipients: subscribers.length,
    })
    .select("id")
    .single();
  if (campError || !campaign) return json({ error: "Failed to create campaign" }, 500);

  // Insert recipients
  const recipientRows = subscribers.map((s) => ({
    campaign_id: campaign.id,
    subscriber_email: s.email,
    subscriber_name: s.name,
    status: "pending" as const,
  }));

  const { error: recipInsertError } = await client
    .from("campaign_recipients")
    .insert(recipientRows);
  if (recipInsertError) {
    return json({ error: "Failed to create recipients" }, 500);
  }

  // Send messages in batches
  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < subscribers.length; i += batchSize) {
    const batch = subscribers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (sub) => {
        const message = replacePlaceholders(tmpl.body, {
          name: sub.name || "",
          email: sub.email,
        });

        let lastError: string | undefined;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const result = await sendSingleMessage(
            conn.endpoint_url,
            conn.api_key,
            conn.sender_name,
            sub.email,
            message,
          );
          if (result.success) {
            return { email: sub.email, success: true };
          }
          lastError = result.error;
        }
        return { email: sub.email, success: false, error: lastError };
      }),
    );

    // Update recipient statuses
    for (const result of results) {
      const now = new Date().toISOString();
      if (result.success) {
        sentCount++;
        await client
          .from("campaign_recipients")
          .update({ status: "sent", sent_at: now })
          .eq("campaign_id", campaign.id)
          .eq("subscriber_email", result.email);
      } else {
        failedCount++;
        await client
          .from("campaign_recipients")
          .update({ status: "failed", error_message: result.error ?? "Unknown error" })
          .eq("campaign_id", campaign.id)
          .eq("subscriber_email", result.email);
      }
    }

    // Update campaign counts progressively
    await client
      .from("campaigns")
      .update({
        sent_count: sentCount,
        failed_count: failedCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaign.id);
  }

  // Finalize campaign status
  const finalStatus = failedCount === subscribers.length ? "failed" : "completed";
  await client
    .from("campaigns")
    .update({ status: finalStatus, updated_at: new Date().toISOString() })
    .eq("id", campaign.id);

  return json({
    campaign_id: campaign.id,
    total: subscribers.length,
    sent: sentCount,
    failed: failedCount,
    status: finalStatus,
  });
}

async function handlePost(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  switch (body.action) {
    case "fetch_subscribers":
      return await handleFetchSubscribers(req, body);
    case "send_campaign":
      return await handleSendCampaign(req, body);
    default:
      return json({ error: "Unknown action" }, 400);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const token = getUserToken(req);
  if (!token) {
    return json({ error: "Authentication required" }, 401);
  }

  try {
    if (req.method === "POST") {
      return await handlePost(req);
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("hoodhad-send failed:", err);
    return json({ error: "Could not process request. Please try again." }, 500);
  }
});
