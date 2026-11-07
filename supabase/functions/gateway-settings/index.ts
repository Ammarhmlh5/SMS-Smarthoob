import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_SENDER_LENGTH = 11;
const BATCH_SIZE_RANGE = { min: 10, max: 100 };
const RETRIES_RANGE = { min: 0, max: 5 };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONNECTION_COLUMNS = "id, endpoint_url, sender_name, api_key, created_at, updated_at";
const PREFERENCE_COLUMNS = "batch_size, max_retries, updated_at";

type ConnectionRow = {
  id: string;
  endpoint_url: string;
  sender_name: string;
  api_key: string;
  created_at: string;
  updated_at: string;
};

type PreferenceRow = {
  batch_size: number;
  max_retries: number;
  updated_at: string;
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

function toPublicConnection(row: ConnectionRow) {
  return {
    id: row.id,
    endpoint_url: row.endpoint_url,
    sender_name: row.sender_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSender(value: unknown): string | null {
  const sender = typeof value === "string" ? value.trim() : "";
  if (sender.length === 0 || sender.length > MAX_SENDER_LENGTH) return null;
  return sender;
}

function isIntegerInRange(value: unknown, range: { min: number; max: number }): value is number {
  return Number.isInteger(value) && (value as number) >= range.min && (value as number) <= range.max;
}

function getUserToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.replace("Bearer ", "");
}

/**
 * Creates a per-user Supabase client that runs with the caller's JWT.
 * RLS policies on gateway_connections and gateway_settings enforce
 * that each user can only access their own rows.
 */
function userClient(token: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
}

async function ensureSettingsRow(client: ReturnType<typeof userClient>): Promise<void> {
  const { data, error } = await client
    .from("gateway_settings")
    .select("user_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { error: insertError } = await client
      .from("gateway_settings")
      .insert({ batch_size: 50, max_retries: 3 });
    if (insertError) throw insertError;
  }
}

async function loadConnections(client: ReturnType<typeof userClient>): Promise<ConnectionRow[]> {
  const { data, error } = await client
    .from("gateway_connections")
    .select(CONNECTION_COLUMNS)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ConnectionRow[];
}

async function loadConnection(client: ReturnType<typeof userClient>, id: string): Promise<ConnectionRow | null> {
  const { data, error } = await client
    .from("gateway_connections")
    .select(CONNECTION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as ConnectionRow | null;
}

async function loadPreferences(client: ReturnType<typeof userClient>): Promise<PreferenceRow> {
  const { data, error } = await client
    .from("gateway_settings")
    .select(PREFERENCE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("gateway_settings row is missing");
  return data as PreferenceRow;
}

async function handleList(token: string) {
  const client = userClient(token);
  await ensureSettingsRow(client);
  const [connections, preferences] = await Promise.all([loadConnections(client), loadPreferences(client)]);
  return json({
    connections: connections.map(toPublicConnection),
    batch_size: preferences.batch_size,
    max_retries: preferences.max_retries,
    updated_at: preferences.updated_at,
  });
}

async function handleCreate(token: string, body: Record<string, unknown>) {
  const client = userClient(token);
  const endpoint = typeof body.endpoint_url === "string" ? normalizeEndpoint(body.endpoint_url) : null;
  if (!endpoint) return json({ error: "Endpoint must be a valid https address" }, 400);
  const sender = normalizeSender(body.sender_name);
  if (!sender) return json({ error: `Sender name must be 1 to ${MAX_SENDER_LENGTH} characters` }, 400);
  const key = typeof body.api_key === "string" ? body.api_key.trim() : "";
  if (key.length === 0) return json({ error: "API key is required" }, 400);

  const { data, error } = await client
    .from("gateway_connections")
    .insert({ endpoint_url: endpoint, sender_name: sender, api_key: key })
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) throw error;
  return json(toPublicConnection(data as ConnectionRow), 201);
}

async function handleUpdate(token: string, body: Record<string, unknown>) {
  const client = userClient(token);
  if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
    return json({ error: "Saved site not found" }, 404);
  }
  const current = await loadConnection(client, body.id);
  if (!current) return json({ error: "Saved site not found" }, 404);

  const changes: Partial<ConnectionRow> = {};

  if (body.endpoint_url !== undefined) {
    const endpoint = typeof body.endpoint_url === "string" ? normalizeEndpoint(body.endpoint_url) : null;
    if (!endpoint) return json({ error: "Endpoint must be a valid https address" }, 400);
    changes.endpoint_url = endpoint;
  }

  if (body.sender_name !== undefined) {
    const sender = normalizeSender(body.sender_name);
    if (!sender) return json({ error: `Sender name must be 1 to ${MAX_SENDER_LENGTH} characters` }, 400);
    changes.sender_name = sender;
  }

  if (body.api_key !== undefined && typeof body.api_key === "string" && body.api_key.trim().length > 0) {
    changes.api_key = body.api_key.trim();
  }

  const { data, error } = await client
    .from("gateway_connections")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", body.id)
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) throw error;
  return json(toPublicConnection(data as ConnectionRow));
}

async function handleDelete(token: string, body: Record<string, unknown>) {
  const client = userClient(token);
  if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
    return json({ error: "Saved site not found" }, 404);
  }
  const { data, error } = await client
    .from("gateway_connections")
    .delete()
    .eq("id", body.id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) return json({ error: "Saved site not found" }, 404);
  return json({ deleted: true, id: body.id });
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[::1\]$/,
  /^\[f[cd]/i,
  /^\[fe80:/i,
];

async function handleTest(token: string, body: Record<string, unknown>) {
  const client = userClient(token);
  if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
    return json({ error: "Saved site not found" }, 404);
  }
  const current = await loadConnection(client, body.id);
  if (!current) return json({ error: "Saved site not found" }, 404);

  const url = new URL(current.endpoint_url);
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    return json({ reachable: false, status: null });
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel();
    return json({ reachable: response.status < 500, status: response.status });
  } catch {
    return json({ reachable: false, status: null });
  }
}

async function handleSavePreferences(token: string, body: Record<string, unknown>) {
  const client = userClient(token);
  const changes: Partial<PreferenceRow> = {};

  if (body.batch_size !== undefined) {
    if (!isIntegerInRange(body.batch_size, BATCH_SIZE_RANGE)) {
      return json({ error: `Batch size must be between ${BATCH_SIZE_RANGE.min} and ${BATCH_SIZE_RANGE.max}` }, 400);
    }
    changes.batch_size = body.batch_size;
  }

  if (body.max_retries !== undefined) {
    if (!isIntegerInRange(body.max_retries, RETRIES_RANGE)) {
      return json({ error: `Retries must be between ${RETRIES_RANGE.min} and ${RETRIES_RANGE.max}` }, 400);
    }
    changes.max_retries = body.max_retries;
  }

  await ensureSettingsRow(client);

  const { error } = await client
    .from("gateway_settings")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("user_id", (await client.auth.getUser()).data.user?.id);
  if (error) throw error;
  return handleList(token);
}

async function handlePost(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  switch (body.action) {
    case "create":
      return await handleCreate(req.headers.get("Authorization")!.replace("Bearer ", ""), body);
    case "update":
      return await handleUpdate(req.headers.get("Authorization")!.replace("Bearer ", ""), body);
    case "delete":
      return await handleDelete(req.headers.get("Authorization")!.replace("Bearer ", ""), body);
    case "test":
      return await handleTest(req.headers.get("Authorization")!.replace("Bearer ", ""), body);
    case "save_preferences":
      return await handleSavePreferences(req.headers.get("Authorization")!.replace("Bearer ", ""), body);
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
    if (req.method === "GET") {
      return await handleList(token);
    }
    if (req.method === "POST") {
      return await handlePost(req);
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("gateway-settings failed:", err);
    return json({ error: "Could not process gateway settings. Please try again." }, 500);
  }
});
